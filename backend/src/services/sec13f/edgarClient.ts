import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const submissionsBaseUrl = "https://data.sec.gov/submissions";
const archivesBaseUrl = "https://www.sec.gov/Archives/edgar/data";
const ftdBaseUrl = "https://www.sec.gov/files/data/fails-deliver-data";
/** Files before 2017-07 only exist under the legacy FOIA path. */
const ftdLegacyBaseUrl =
  "https://www.sec.gov/files/data/frequently-requested-foia-document-fails-deliver-data";
const defaultDelayMs = 150;
const ftdMaxBufferBytes = 128 * 1024 * 1024;

export interface ManagerFiling {
  form: string;
  period: string;
  accession: string;
  acceptance_ms: number;
}

export interface Edgar13fClient {
  fetchManagerFilings(cik: number): Promise<ManagerFiling[]>;
  fetchInfotableXml(cik: number, accession: string): Promise<string>;
  /** Returns null when the half-month file is not published (HTTP 403/404). */
  fetchFtdText(yyyymm: string): Promise<string | null>;
}

export interface Edgar13fClientOptions {
  userAgent: string;
  submissionsBaseUrl?: string;
  archivesBaseUrl?: string;
  ftdBaseUrl?: string;
  delayMs?: number;
}

interface SubmissionColumns {
  form: string[];
  reportDate: string[];
  accessionNumber: string[];
  acceptanceDateTime: string[];
}

function collectThirteenFRows(columns: SubmissionColumns): ManagerFiling[] {
  const filings: ManagerFiling[] = [];
  for (let i = 0; i < columns.form.length; i += 1) {
    if (!columns.form[i].startsWith("13F-HR")) {
      continue;
    }
    const acceptanceMs = Date.parse(columns.acceptanceDateTime[i]);
    if (!columns.reportDate[i] || Number.isNaN(acceptanceMs)) {
      continue;
    }
    filings.push({
      form: columns.form[i],
      period: columns.reportDate[i],
      accession: columns.accessionNumber[i],
      acceptance_ms: acceptanceMs,
    });
  }
  return filings;
}

export function createEdgar13fClient(options: Edgar13fClientOptions): Edgar13fClient {
  const submissionsBase = options.submissionsBaseUrl ?? submissionsBaseUrl;
  const archivesBase = options.archivesBaseUrl ?? archivesBaseUrl;
  const ftdBase = options.ftdBaseUrl ?? ftdBaseUrl;
  const ftdLegacyBase = options.ftdBaseUrl ?? ftdLegacyBaseUrl;
  const delayMs = options.delayMs ?? defaultDelayMs;

  async function get(url: string): Promise<Response> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fetch(url, { headers: { "User-Agent": options.userAgent } });
  }

  async function getJson(url: string): Promise<unknown> {
    const response = await get(url);
    if (!response.ok) {
      throw new Error(`SEC request failed: HTTP ${response.status} for ${url}`);
    }
    return response.json();
  }

  return {
    async fetchManagerFilings(cik: number): Promise<ManagerFiling[]> {
      const padded = String(cik).padStart(10, "0");
      const root = (await getJson(`${submissionsBase}/CIK${padded}.json`)) as {
        filings: { recent: SubmissionColumns; files?: Array<{ name: string }> };
      };
      const filings = collectThirteenFRows(root.filings.recent);
      for (const page of root.filings.files ?? []) {
        const columns = (await getJson(`${submissionsBase}/${page.name}`)) as SubmissionColumns;
        filings.push(...collectThirteenFRows(columns));
      }
      return filings;
    },

    async fetchInfotableXml(cik: number, accession: string): Promise<string> {
      const accessionDir = accession.replaceAll("-", "");
      const index = (await getJson(`${archivesBase}/${cik}/${accessionDir}/index.json`)) as {
        directory: { item: Array<{ name: string; size?: string }> };
      };
      const candidates = index.directory.item
        .filter((item) => {
          const name = item.name.toLowerCase();
          return name.endsWith(".xml") && name !== "primary_doc.xml";
        })
        .sort((left, right) => Number(right.size ?? 0) - Number(left.size ?? 0));
      if (candidates.length === 0) {
        throw new Error(`No information table XML found in ${accession} for CIK ${cik}.`);
      }
      const response = await get(`${archivesBase}/${cik}/${accessionDir}/${candidates[0].name}`);
      if (!response.ok) {
        throw new Error(`SEC request failed: HTTP ${response.status} for ${accession}.`);
      }
      return response.text();
    },

    async fetchFtdText(yyyymm: string): Promise<string | null> {
      const fileName = `cnsfails${yyyymm}a`;
      let response = await get(`${ftdBase}/${fileName}.zip`);
      if (response.status === 403 || response.status === 404) {
        response = await get(`${ftdLegacyBase}/${fileName}.zip`);
      }
      if (response.status === 403 || response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`FTD download failed: HTTP ${response.status} for ${fileName}.zip`);
      }
      const workDir = await mkdtemp(join(tmpdir(), "geridon-ftd-"));
      try {
        const zipPath = join(workDir, `${fileName}.zip`);
        await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
        const { stdout } = await execFileAsync("unzip", ["-p", zipPath], {
          maxBuffer: ftdMaxBufferBytes,
          encoding: "latin1",
        });
        return stdout;
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}

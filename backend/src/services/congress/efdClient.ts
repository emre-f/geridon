const efdBaseUrl = "https://efdsearch.senate.gov";
const searchPageSize = 100;
const defaultDelayMs = 350;

/**
 * The eFD front end sits behind Akamai, which rejects non-browser TLS/UA
 * combinations; Node's fetch passes with a browser user agent where curl does
 * not. Access requires accepting the site's prohibition agreement (no
 * commercial use of the data), which the session handshake does explicitly.
 */
const browserUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** [first_name, last_name, filer_title, report_link_html, date_received] */
export type EfdSearchRow = [string, string, string, string, string];

export interface EfdClient {
  searchPtrFilings(year: number): Promise<EfdSearchRow[]>;
  fetchReportHtml(path: string): Promise<string>;
}

export interface EfdClientOptions {
  baseUrl?: string;
  userAgent?: string;
  delayMs?: number;
}

export function createEfdClient(options: EfdClientOptions = {}): EfdClient {
  const baseUrl = options.baseUrl ?? efdBaseUrl;
  const userAgent = options.userAgent ?? browserUserAgent;
  const delayMs = options.delayMs ?? defaultDelayMs;

  const jar = new Map<string, string>();
  let sessionReady = false;

  const cookieHeader = () => [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");

  function storeCookies(response: Response): void {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  async function pace(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  async function get(path: string): Promise<Response> {
    await pace();
    const response = await fetch(baseUrl + path, {
      headers: { "User-Agent": userAgent, Cookie: cookieHeader() },
      redirect: "manual",
    });
    storeCookies(response);
    return response;
  }

  async function post(path: string, body: string, referer: string): Promise<Response> {
    await pace();
    const response = await fetch(baseUrl + path, {
      method: "POST",
      headers: {
        "User-Agent": userAgent,
        Cookie: cookieHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: baseUrl + referer,
        "X-CSRFToken": jar.get("csrftoken") ?? "",
      },
      body,
      redirect: "manual",
    });
    storeCookies(response);
    return response;
  }

  async function establishSession(): Promise<void> {
    jar.clear();
    const home = await get("/search/home/");
    if (home.status !== 200) {
      throw new Error(`eFD home page returned HTTP ${home.status}.`);
    }
    const agreement = await post(
      "/search/home/",
      new URLSearchParams({
        prohibition_agreement: "1",
        csrfmiddlewaretoken: jar.get("csrftoken") ?? "",
      }).toString(),
      "/search/home/",
    );
    if (agreement.status !== 302) {
      throw new Error(`eFD agreement submission returned HTTP ${agreement.status}.`);
    }
    await get("/search/");
    sessionReady = true;
  }

  async function withSession<T>(request: () => Promise<T>): Promise<T> {
    if (!sessionReady) {
      await establishSession();
      return request();
    }
    try {
      return await request();
    } catch {
      await establishSession();
      return request();
    }
  }

  async function searchPage(year: number, start: number): Promise<EfdSearchRow[]> {
    const body = new URLSearchParams({
      draw: "1",
      start: String(start),
      length: String(searchPageSize),
      report_types: "[11]",
      filer_types: "[]",
      submitted_start_date: `01/01/${year} 00:00:00`,
      submitted_end_date: `12/31/${year} 23:59:59`,
      candidate_state: "",
      senator_state: "",
      office_id: "",
      first_name: "",
      last_name: "",
    });
    const response = await post("/search/report/data/", body.toString(), "/search/");
    if (response.status !== 200) {
      throw new Error(`eFD search returned HTTP ${response.status} for ${year}.`);
    }
    const json = (await response.json()) as { result?: string; data?: EfdSearchRow[] };
    if (json.result !== "ok" || !Array.isArray(json.data)) {
      throw new Error(`eFD search returned an unexpected payload for ${year}.`);
    }
    return json.data;
  }

  return {
    async searchPtrFilings(year: number): Promise<EfdSearchRow[]> {
      const rows: EfdSearchRow[] = [];
      for (let start = 0; ; start += searchPageSize) {
        const page = await withSession(() => searchPage(year, start));
        rows.push(...page);
        if (page.length < searchPageSize) {
          return rows;
        }
      }
    },

    async fetchReportHtml(path: string): Promise<string> {
      return withSession(async () => {
        const response = await get(path);
        if (response.status !== 200) {
          throw new Error(`eFD report page returned HTTP ${response.status} for ${path}.`);
        }
        return response.text();
      });
    },
  };
}

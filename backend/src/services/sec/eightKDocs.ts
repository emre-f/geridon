const archiveBaseUrl = "https://www.sec.gov/Archives/edgar/data";

const manifestDocumentPattern =
  /&lt;TYPE&gt;([^\r\n]*)\r?\n&lt;SEQUENCE&gt;([^\r\n]*)\r?\n&lt;FILENAME&gt;([^\r\n]*)/g;
const exhibitTypePattern = /^EX-99/i;
const textFilenamePattern = /\.(htm|html|txt)$/i;

export interface ManifestDocument {
  type: string;
  sequence: number;
  filename: string;
}

/** Parses the escaped SGML document list inside a filing's -index-headers.html. */
export function parseDocumentManifest(indexHeadersHtml: string): ManifestDocument[] {
  const documents: ManifestDocument[] = [];
  for (const match of indexHeadersHtml.matchAll(manifestDocumentPattern)) {
    documents.push({
      type: unescapeEntities(match[1].trim()),
      sequence: Number(match[2].trim()),
      filename: unescapeEntities(match[3].trim()),
    });
  }
  return documents;
}

function unescapeEntities(value: string): string {
  return value.replaceAll("&amp;", "&");
}

export interface SelectedDocuments {
  primary: string | null;
  exhibits: string[];
}

/**
 * The primary document is the 8-K body; EX-99 exhibits are the attached press
 * releases the labeler reads. Binary/XBRL exhibits are never fetched.
 */
export function selectDocumentFiles(
  manifest: ManifestDocument[],
  primaryDocument: string,
): SelectedDocuments {
  const primary =
    (primaryDocument ||
      manifest.find((document) => document.type.startsWith("8-K"))?.filename) ??
    null;
  const exhibits = manifest
    .filter(
      (document) =>
        exhibitTypePattern.test(document.type) &&
        textFilenamePattern.test(document.filename) &&
        document.filename !== primary,
    )
    .map((document) => document.filename);
  return { primary, exhibits };
}

export function accessionPath(accession: string): string {
  return accession.replaceAll("-", "");
}

export function filingFileUrl(cik: number, accession: string, filename: string): string {
  return `${archiveBaseUrl}/${cik}/${accessionPath(accession)}/${filename}`;
}

export function indexHeadersUrl(cik: number, accession: string): string {
  return filingFileUrl(cik, accession, `${accession}-index-headers.html`);
}

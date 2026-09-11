const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  mdash: "-",
  ndash: "-",
};

const blockTagPattern = /<\/?(p|div|br|tr|h[1-6]|li|table)\b[^>]*>/gi;
const dropElementPattern = /<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi;
const tagPattern = /<[^>]*>/g;
const tablePattern = /<table\b[^>]*>[\s\S]*?<\/table>/gi;

/**
 * Financial statement tables are the bulk of an earnings exhibit's bytes and
 * carry no narrative the labeler can use, so tables that are mostly figures are
 * dropped before the character budget is spent. Prose tables (some filers lay
 * out press release body text in a table) stay.
 */
const numericTableRatio = 0.4;

export function stripNumericTables(html: string): string {
  return html.replace(tablePattern, (table) => {
    const text = htmlToText(table);
    if (text.length === 0) {
      return " ";
    }
    const figures = text.replace(/[^0-9]/g, "").length;
    return figures / text.length >= numericTableRatio ? " " : table;
  });
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(dropElementPattern, " ")
      .replace(blockTagPattern, "\n")
      .replace(tagPattern, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function documentToText(html: string): string {
  return htmlToText(stripNumericTables(html));
}

export interface FilingTextPart {
  filename: string;
  text: string;
}

/**
 * Budgets are per document rather than per filing so a long press release can
 * never crowd the 8-K body (which names the items) out of the prompt.
 */
export const primaryCharBudget = 12_000;
export const exhibitCharBudget = 16_000;
export const maxExhibits = 3;

export function truncate(text: string, budget: number): string {
  if (text.length <= budget) {
    return text;
  }
  return `${text.slice(0, budget).trimEnd()}\n[truncated]`;
}

export function assembleFilingText(
  primary: FilingTextPart | null,
  exhibits: readonly FilingTextPart[],
): string {
  const sections: string[] = [];
  if (primary != null) {
    sections.push(`--- 8-K body (${primary.filename}) ---\n${truncate(primary.text, primaryCharBudget)}`);
  }
  for (const exhibit of exhibits.slice(0, maxExhibits)) {
    sections.push(`--- exhibit (${exhibit.filename}) ---\n${truncate(exhibit.text, exhibitCharBudget)}`);
  }
  return sections.join("\n\n");
}

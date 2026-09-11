import { createHash } from "node:crypto";

export const promptTemplate = `You label SEC Form 8-K filings for a quantitative research pipeline.

Read the filing text below and emit one label per material event it discloses.
Emit an empty labels array when the filing discloses nothing that fits a kind:
that is the common, expected answer for routine filings. Never invent an event
to fill the array.

Kinds:
- "guidance": the COMPANY states its own expectation for its future financial
  results for a specified future period, in its own voice ("we expect", "the
  Company now sees", "outlook", "guidance", "reaffirms"). Reported results for a
  period that has already ended are NOT guidance. The following are NOT guidance
  even though they name a future dollar figure: illustrative, hypothetical, or
  "potential"/"could"/"up to" amounts; an opportunity, pipeline, or market size
  in an investor presentation; figures from a reserve, resource, or other
  technical report; and third-party or analyst estimates. When you cannot tell
  whether a number is the company's own committed outlook or just a
  forward-looking mention, it is not guidance.
- "buyback": a new or expanded share repurchase authorization. Routine reporting
  of shares already repurchased under an existing authorization is not a buyback.
- "exec_departure_unplanned": an officer or director DEPARTS and the filing gives
  no orderly reason: resignation effective immediately, termination for cause,
  departure "to pursue other interests" with no successor, death, or a
  disagreement with the company.
- "exec_departure_routine": an officer or director DEPARTS in an orderly way: a
  planned retirement, or an announced succession with a named successor and a
  transition period.

Someone must actually leave for either departure kind. A filing that only
appoints, hires, elects, or re-elects a person, or only sets a compensation
arrangement, with no one departing, is NOT an exec_departure event: label only
its other material events, or emit an empty array.

direction, from the perspective of an investor holding the stock:
- "up": the disclosure is favorable (guidance raised, buyback authorized).
- "down": the disclosure is unfavorable (guidance cut, guidance withdrawn, an
  unplanned departure of a CEO/CFO).
- "none": genuinely neutral or ambiguous. Use it rather than guessing.

For guidance, take direction from how the filing frames the change: "up" when it
raises, increases, or guides above its prior view; "down" when it lowers,
reduces, guides below, or withdraws; "none" only for a first-time initiation or
a plain reaffirmation with no directional language.

severity, 1-5, how materially a well-informed investor would react:
1 = trivial or boilerplate, 2 = minor, 3 = ordinary material news,
4 = significant, 5 = severe or transformative. Most labels are 2-4; reserve 5
for events like a CEO terminated for cause or guidance withdrawn entirely.

rationale: ONE short sentence, quoting the filing's own language where possible.

guidance: for "guidance" labels only, extract the company's HEADLINE outlook
figures - the few top-line metrics it leads with, typically revenue, earnings
per share, and at most one or two others it explicitly highlights. Do NOT
itemize a projected reconciliation, bridge, or segment table: when the filing
walks GAAP to non-GAAP or breaks a total into components, keep only the summary
total it guides, never every line. Aim for a handful of figures, not dozens.
Extract only a figure that appears in the filing text above; never add one from
outside knowledge or infer a number the text does not state.
Use "low"/"high" for a range and "point" for a single figure, never both. Leave
all three null when the filing revises guidance without naming a number.
"metric" is the filer's own term ("revenue", "adjusted EPS", "gross margin").
"period" is the period guided ("Q4 2024", "FY 2025"). Figures keep the filing's
own units and are never rescaled: write 49 and 52 for "between $49 billion and
$52 billion". "unit" then records the scale those figures are in, as one of
"USD", "USD thousands", "USD millions", "USD billions", "USD per share",
"percent", or "count". One filing often mixes scales, so set "unit" per figure,
never once per filing. Use an empty array for every non-guidance label.

Return only the JSON object described by the output schema.`;

export interface FilingPromptContext {
  ticker: string;
  items: readonly string[];
  filed_date: string;
  text: string;
}

export function buildLabelPrompt(context: FilingPromptContext): string {
  return [
    promptTemplate,
    "",
    `Ticker: ${context.ticker}`,
    `Filed: ${context.filed_date}`,
    `8-K items: ${context.items.join(", ") || "none reported"}`,
    "",
    "Filing text:",
    context.text,
  ].join("\n");
}

/**
 * The evaluation contract: a label is only comparable to labels produced by the
 * same model, reasoning effort AND prompt, so all three are folded into one
 * identifier that names the cache directory. Editing `promptTemplate` at all
 * changes the hash, and switching effort mints a fresh version rather than
 * silently mixing medium- and high-effort labels under one name.
 */
export function labelerVersion(model: string, effort: string): string {
  const hash = createHash("sha256").update(promptTemplate).digest("hex").slice(0, 12);
  return `${model}-${effort}-${hash}`;
}

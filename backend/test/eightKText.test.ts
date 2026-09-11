import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleFilingText,
  documentToText,
  htmlToText,
  primaryCharBudget,
  stripNumericTables,
} from "../src/services/sec/eightKText.ts";

test("htmlToText strips markup, decodes entities, and keeps block breaks", () => {
  const text = htmlToText(
    "<html><head><style>p{color:red}</style></head><body><p>Q4&nbsp;revenue rose&nbsp;12%</p>" +
      "<div>CEO said &ldquo;strong&rdquo;</div></body></html>",
  );
  assert.equal(text, 'Q4 revenue rose 12%\n\nCEO said "strong"');
  assert.ok(!text.includes("color:red"));
});

test("stripNumericTables drops figure tables and keeps prose tables", () => {
  const numericTable =
    "<table><tr><td>1,234</td><td>5,678</td><td>9,012</td></tr><tr><td>3,456</td></tr></table>";
  const proseTable =
    "<table><tr><td>The board authorized a new share repurchase program today.</td></tr></table>";
  const stripped = stripNumericTables(`<div>Intro</div>${numericTable}${proseTable}`);

  assert.ok(!stripped.includes("1,234"));
  assert.ok(stripped.includes("share repurchase program"));
});

test("documentToText survives an SGML-wrapped EDGAR document", () => {
  const text = documentToText(
    "<DOCUMENT>\n<TYPE>EX-99.1\n<FILENAME>press.htm\n<TEXT>\n" +
      "<html><body><p>Acme raises FY guidance.</p></body></html>",
  );
  assert.ok(text.includes("Acme raises FY guidance."));
});

test("assembleFilingText truncates per document and marks the cut", () => {
  const assembled = assembleFilingText(
    { filename: "body.htm", text: "x".repeat(primaryCharBudget + 500) },
    [{ filename: "press.htm", text: "short exhibit" }],
  );
  assert.ok(assembled.includes("[truncated]"));
  assert.ok(assembled.includes("--- 8-K body (body.htm) ---"));
  assert.ok(assembled.includes("short exhibit"));
  assert.ok(assembled.length < primaryCharBudget + 1000);
});

test("assembleFilingText caps the number of exhibits", () => {
  const exhibits = Array.from({ length: 6 }, (_, index) => ({
    filename: `ex${index}.htm`,
    text: `exhibit ${index}`,
  }));
  const assembled = assembleFilingText(null, exhibits);
  assert.ok(assembled.includes("exhibit 2"));
  assert.ok(!assembled.includes("exhibit 3"));
});

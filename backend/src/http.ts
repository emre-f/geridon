import type { IncomingMessage, ServerResponse } from "node:http";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    ...corsHeaders,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function sendNoContent(response: ServerResponse): void {
  response.writeHead(204, corsHeaders);
  response.end();
}

export async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    throw new Error("Request body must be valid JSON.");
  }

  return JSON.parse(raw) as T;
}

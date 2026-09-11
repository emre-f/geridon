import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Settings {
  polygonApiKey?: string;
  databaseUrl: string;
  polygonBaseUrl: string;
  yahooBaseUrl: string;
  secUserAgent?: string;
  port: number;
}

export const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(): void {
  const envPath = resolve(backendRoot, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

loadEnvFile();

export function getSettings(): Settings {
  return {
    polygonApiKey: process.env.POLYGON_API_KEY,
    databaseUrl: process.env.GERIDON_DATABASE_URL ?? "sqlite:///./data/geridon.sqlite3",
    polygonBaseUrl: process.env.POLYGON_BASE_URL ?? "https://api.polygon.io",
    yahooBaseUrl: process.env.YAHOO_BASE_URL ?? "https://query1.finance.yahoo.com",
    secUserAgent: process.env.SEC_USER_AGENT,
    port: Number(process.env.PORT ?? 8000),
  };
}

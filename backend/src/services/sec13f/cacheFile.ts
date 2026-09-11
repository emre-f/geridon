import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Cached files are the unit of work; a cache hit never touches the network. */
export async function ensureCached(
  path: string,
  fetchContent: () => Promise<string>,
): Promise<string> {
  if (existsSync(path)) {
    return readFile(path, "utf8");
  }
  const content = await fetchContent();
  await mkdir(dirname(path), { recursive: true });
  const partialPath = `${path}.partial`;
  await writeFile(partialPath, content);
  await rename(partialPath, path);
  return content;
}

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { filingLabelJsonSchema } from "./eightKLabelSchema.ts";

export const defaultLabelModel = "gpt-5.5";
const runTimeoutMs = 180_000;

export interface LabelRunner {
  run: (prompt: string) => Promise<string>;
}

interface CommandResult {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, runTimeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut });
    });
  });
}

/**
 * Labeling is bulk mechanical work, so it runs on the cheap model through the
 * Codex CLI. Every invocation is sandboxed read-only in a scratch directory
 * with no repository access: the labeler reads a prompt and writes one JSON
 * file, and must not be able to touch anything else.
 */
export function createCodexRunner(model = defaultLabelModel): LabelRunner {
  return {
    async run(prompt: string): Promise<string> {
      const workDir = await mkdtemp(join(tmpdir(), "geridon-label-"));
      try {
        const schemaPath = join(workDir, "schema.json");
        const outputPath = join(workDir, "label.json");
        const promptPath = join(workDir, "prompt.txt");
        await writeFile(schemaPath, JSON.stringify(filingLabelJsonSchema));
        await writeFile(promptPath, prompt);

        const result = await runCommand(
          "codex",
          [
            "exec",
            "--model",
            model,
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--ephemeral",
            "--color",
            "never",
            "--cd",
            workDir,
            "--output-schema",
            schemaPath,
            "--output-last-message",
            outputPath,
            prompt,
          ],
          workDir,
        );
        if (result.timedOut) {
          throw new Error(`codex exec timed out after ${runTimeoutMs}ms`);
        }
        if (result.code !== 0) {
          throw new Error(`codex exec exited ${result.code}: ${result.stderr.trim().slice(0, 400)}`);
        }
        return await readFile(outputPath, "utf8");
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}

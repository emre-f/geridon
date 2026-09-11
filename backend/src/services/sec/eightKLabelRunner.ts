import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { labelerVersion } from "./eightKLabelPrompt.ts";
import { filingLabelJsonSchema } from "./eightKLabelSchema.ts";

export const defaultLabelModel = "gpt-5.6-sol";
/** Labeling is extraction, not reasoning; medium keeps it cheap without going shallow. */
export const defaultLabelEffort = "medium";
const runTimeoutMs = 180_000;

export interface LabelerChoice {
  model: string;
  effort: string;
  version: string;
}

/**
 * Reads the shared `--model=` / `--effort=` options every 8-K subcommand accepts
 * and folds them into the labeler version, so a label run and the commands that
 * later read those labels agree on the cache directory from the same flags.
 */
export function labelerChoiceFromArgs(args: string[]): LabelerChoice {
  const option = (prefix: string, fallback: string): string => {
    const found = args.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };
  const model = option("--model=", defaultLabelModel);
  const effort = option("--effort=", defaultLabelEffort);
  return { model, effort, version: labelerVersion(model, effort) };
}

/**
 * The seam between the pipeline and whichever model grades a filing: given one
 * prompt, return one JSON string matching the label schema. The transport is
 * chosen from the model name - OpenAI models (`gpt-*`) run through the Codex CLI
 * (`createCodexRunner`), Claude models through the Claude Code CLI
 * (`createClaudeRunner`, subscription auth) - so a new backend is a new
 * `LabelRunner`, not a change to the labeling logic.
 */
export interface LabelRunner {
  run: (prompt: string) => Promise<string>;
}

export function createLabelRunner(model: string, effort: string): LabelRunner {
  return model.startsWith("gpt-") ? createCodexRunner(model, effort) : createClaudeRunner(model, effort);
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, runTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Labeling is bulk mechanical work, so it runs on the cheap model through the
 * Codex CLI. Every invocation is sandboxed read-only in a scratch directory
 * with no repository access: the labeler reads a prompt and writes one JSON
 * file, and must not be able to touch anything else.
 */
export function createCodexRunner(
  model = defaultLabelModel,
  effort = defaultLabelEffort,
): LabelRunner {
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
            "-c",
            `model_reasoning_effort="${effort}"`,
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

function claudeModelId(model: string): string {
  return model.startsWith("claude-") ? model : `claude-${model}`;
}

/**
 * The claude CLI has no --output-schema flag, so the schema rides in the prompt
 * as transport framing - outside `promptTemplate`, so the labeler version hash
 * is unchanged and claude labels stay comparable to codex labels under the same
 * version. Runs headless on subscription auth in a scratch cwd (no repo
 * CLAUDE.md, no session persistence, mutating/network tools denied).
 */
export function createClaudeRunner(
  model = defaultLabelModel,
  effort = defaultLabelEffort,
): LabelRunner {
  return {
    async run(prompt: string): Promise<string> {
      const workDir = await mkdtemp(join(tmpdir(), "geridon-label-"));
      try {
        const framedPrompt =
          `${prompt}\n\nOutput schema (JSON Schema): ${JSON.stringify(filingLabelJsonSchema)}\n` +
          "Respond with only the raw JSON object - no markdown fences, no commentary.";
        const result = await runCommand(
          "claude",
          [
            "-p",
            "--model",
            claudeModelId(model),
            "--effort",
            effort,
            "--output-format",
            "text",
            "--no-session-persistence",
            "--disallowedTools",
            "Bash,Edit,Write,WebFetch,WebSearch,Task",
            "--",
            framedPrompt,
          ],
          workDir,
        );
        if (result.timedOut) {
          throw new Error(`claude -p timed out after ${runTimeoutMs}ms`);
        }
        if (result.code !== 0) {
          throw new Error(`claude -p exited ${result.code}: ${result.stderr.trim().slice(0, 400)}`);
        }
        const start = result.stdout.indexOf("{");
        const end = result.stdout.lastIndexOf("}");
        if (start === -1 || end === -1) {
          throw new Error(`claude -p returned no JSON object: ${result.stdout.trim().slice(0, 200)}`);
        }
        return result.stdout.slice(start, end + 1);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}

// Draft generation pipeline (PRD §7 "Generation workflow and retry policy"):
// one draft call, at most one transient retry, at most one schema repair; max 3 invocations.
import { z } from "zod";
import { DraftResult, MAX_DRAFT_BYTES, type ProjectContent } from "@/schemas/content";
import { validateDraft, type ChunkRef } from "@/domain/evidence";
import { buildRepairPrompt, buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT, type Template } from "./prompt";
import { ProviderError, type ChatMessage, type CompletionUsage, type ModelProvider } from "./provider";

export const MAX_SOURCE_CHARS = 80_000;
export const MAX_INVOCATIONS = 3;

export interface GenerateInput {
  chunks: ChunkRef[];
  sourceTitles: Record<string, string>;
  template: Template;
  baseContent?: ProjectContent;
  userContext?: string;
  allowedAssetIds?: string[];
  approvedLinks?: ProjectContent["publicLinks"];
  signal?: AbortSignal;
  /** Injected for tests; defaults to a real delay. */
  sleep?: (ms: number) => Promise<void>;
}

export interface GenerateOutput {
  result: DraftResult;
  model: string;
  promptVersion: string;
  usage: CompletionUsage[];
}

export class GenerationError extends Error {
  constructor(
    readonly code: "input_too_large" | "empty_input" | "invalid_output" | "provider_error",
    message: string,
    readonly usage: CompletionUsage[],
    readonly retryable = false,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

const draftJsonSchema = z.toJSONSchema(DraftResult, { target: "draft-2020-12" }) as Record<string, unknown>;

export async function generateDraft(provider: ModelProvider, input: GenerateInput): Promise<GenerateOutput> {
  const totalChars = input.chunks.reduce((n, c) => n + c.text.length, 0);
  if (totalChars === 0) throw new GenerationError("empty_input", "No source text selected.", []);
  if (totalChars > MAX_SOURCE_CHARS) {
    throw new GenerationError("input_too_large", `Selected sources exceed ${MAX_SOURCE_CHARS} characters; select fewer sources.`, []);
  }

  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const usage: CompletionUsage[] = [];
  let invocations = 0;
  let transientRetryUsed = false;
  let model = provider.id;

  const call = async (messages: ChatMessage[]) => {
    for (;;) {
      if (invocations >= MAX_INVOCATIONS) {
        throw new GenerationError("provider_error", "Generation attempt limit reached.", usage);
      }
      invocations++;
      try {
        const res = await provider.complete({
          messages,
          jsonSchema: draftJsonSchema,
          schemaName: "draft_result",
          maxTokens: 8000,
          signal: input.signal,
        });
        usage.push(res.usage);
        model = res.model;
        return res.text;
      } catch (err) {
        if (err instanceof ProviderError && err.retryable && !transientRetryUsed) {
          transientRetryUsed = true;
          await sleep(1500);
          continue;
        }
        const retryable = err instanceof ProviderError && err.retryable;
        throw new GenerationError("provider_error", err instanceof Error ? err.message : "Provider error", usage, retryable);
      }
    }
  };

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(input) },
  ];

  let raw = await call(messages);
  let parsed = parseDraft(raw);
  if (!parsed.ok) {
    raw = await call([...messages, { role: "assistant", content: raw }, { role: "user", content: buildRepairPrompt(raw, parsed.issues) }]);
    parsed = parseDraft(raw);
    if (!parsed.ok) {
      throw new GenerationError("invalid_output", "The model returned an invalid draft twice. Your sources are saved; try again or edit manually.", usage);
    }
  }

  const result = validateDraft(parsed.value, {
    chunks: input.chunks,
    allowedAssetIds: input.allowedAssetIds,
    approvedLinks: input.approvedLinks,
  });
  return { result, model, promptVersion: PROMPT_VERSION, usage };
}

type Parsed = { ok: true; value: DraftResult } | { ok: false; issues: string };

export function parseDraft(raw: string): Parsed {
  if (Buffer.byteLength(raw, "utf8") > MAX_DRAFT_BYTES) return { ok: false, issues: "Output exceeds 40 KB; be more concise." };
  let json: unknown;
  try {
    json = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, issues: "Output is not valid JSON." };
  }
  const res = DraftResult.safeParse(json);
  if (res.success) return { ok: true, value: res.data };
  const issues = res.error.issues
    .slice(0, 20)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  return { ok: false, issues };
}

// Some models wrap JSON in markdown fences despite json_schema mode.
function stripFences(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : s;
}

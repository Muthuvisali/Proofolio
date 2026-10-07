import "server-only";
import OpenAI from "openai";
import { ProviderError, type CompletionRequest, type CompletionResult, type ModelProvider } from "./provider";

const DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";

/** Nebius Token Factory via its OpenAI-compatible API, serving NVIDIA Nemotron models. */
export class NebiusProvider implements ModelProvider {
  readonly id = "nebius";
  private client: OpenAI;

  constructor(
    apiKey: string,
    private model: string,
    baseURL = DEFAULT_BASE_URL,
  ) {
    // Retries are owned by the generation job policy, not the SDK.
    this.client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 90_000 });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    try {
      const res = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: 0.2,
          response_format: {
            type: "json_schema",
            json_schema: { name: req.schemaName, schema: req.jsonSchema },
          },
        },
        { signal: req.signal },
      );
      return {
        text: res.choices[0]?.message?.content ?? "",
        model: res.model ?? this.model,
        usage: {
          promptTokens: res.usage?.prompt_tokens ?? 0,
          completionTokens: res.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 0;
    if (status === 429) return new ProviderError("Model provider rate limit", "rate_limited", true);
    if (status === 401 || status === 403) return new ProviderError("Model provider rejected credentials", "auth", false);
    if (status >= 500) return new ProviderError("Model provider unavailable", "unavailable", true);
    if (status >= 400) return new ProviderError("Model provider rejected the request", "bad_request", false);
  }
  if (err instanceof Error && /abort|timeout/i.test(err.name + err.message)) {
    return new ProviderError("Model provider timed out", "timeout", true);
  }
  return new ProviderError("Model provider error", "unknown", true);
}

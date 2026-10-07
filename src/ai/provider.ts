// Model-provider abstraction. Real generation uses Nebius Token Factory (NVIDIA Nemotron);
// tests use a deterministic fixture provider. Sample mode never calls a provider.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** JSON Schema the response must follow. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface CompletionUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage: CompletionUsage;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: "rate_limited" | "unavailable" | "timeout" | "bad_request" | "auth" | "unknown",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ModelProvider {
  readonly id: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

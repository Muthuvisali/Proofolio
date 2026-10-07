// Deterministic provider for automated tests. Never used for user-facing generation.
import { ProviderError, type CompletionRequest, type CompletionResult, type ModelProvider } from "./provider";

export type FixtureStep = string | ProviderError;

export class FixtureProvider implements ModelProvider {
  readonly id = "fixture";
  readonly calls: CompletionRequest[] = [];

  constructor(private steps: FixtureStep[]) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    const step = this.steps.shift();
    if (step === undefined) throw new Error("FixtureProvider: no more scripted responses");
    if (step instanceof ProviderError) throw step;
    return { text: step, model: "fixture-model", usage: { promptTokens: 10, completionTokens: 20 } };
  }
}

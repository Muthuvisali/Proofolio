import { describe, expect, it } from "vitest";
import { generateDraft, GenerationError } from "@/ai/generate";
import { FixtureProvider } from "@/ai/fixture";
import { ProviderError } from "@/ai/provider";
import { emptyContent, type DraftResult } from "@/schemas/content";
import { quoteMatches, resolvePointer, unresolvedClaims } from "@/domain/evidence";

const SRC = "11111111-1111-4111-8111-111111111111";
const CHUNK = "22222222-2222-4222-8222-222222222222";
const chunkText =
  "I built a study-planner prototype and designed the prioritization flow myself. " +
  "We target a 20% reduction in planning time; not tested yet. No usability study has been run.";

const baseInput = {
  chunks: [{ id: CHUNK, sourceId: SRC, text: chunkText }],
  sourceTitles: { [SRC]: "Notes" },
  template: "product_case_study" as const,
  sleep: async () => {},
};

function draft(overrides: Partial<DraftResult["content"]> = {}, claims: DraftResult["claims"] = []): DraftResult {
  return {
    content: { ...emptyContent("Study Planner"), summary: "A study planner prototype.", role: "I designed the prioritization flow.", projectStage: "prototype", ...overrides },
    claims,
    missingInformation: [],
    warnings: [],
  };
}

const ev = (quote: string, sourceId = SRC, chunkId = CHUNK) => [{ sourceId, chunkId, quote }];

describe("generateDraft truthfulness", () => {
  it("AT-04: an untested target labeled observed is flagged for review", async () => {
    const d = draft({ outcomes: [{ id: "o1", text: "Reduced planning time by 20%", kind: "observed" }] }, [
      { id: "c1", fieldPath: "/outcomes/0/text", statement: "Reduced planning time by 20%", status: "source_supported", evidence: ev("We target a 20% reduction in planning time; not tested yet.") },
    ]);
    const out = await generateDraft(new FixtureProvider([JSON.stringify(d)]), baseInput);
    const claim = out.result.claims.find((c) => c.fieldPath === "/outcomes/0/text")!;
    expect(claim.status).toBe("needs_review");
    expect(out.result.warnings.join(" ")).toMatch(/goal or untested/);
    expect(unresolvedClaims(out.result.content, out.result.claims).length).toBeGreaterThan(0);
  });

  it("keeps a proposed outcome proposed and supported", async () => {
    const d = draft({ outcomes: [{ id: "o1", text: "Target: 20% less planning time (not tested).", kind: "proposed" }] }, [
      { id: "c1", fieldPath: "/outcomes/0/text", statement: "Target: 20% less planning time (not tested).", status: "source_supported", evidence: ev("target a 20% reduction in planning time") },
    ]);
    const out = await generateDraft(new FixtureProvider([JSON.stringify(d)]), baseInput);
    expect(out.result.content.outcomes[0].kind).toBe("proposed");
    expect(out.result.claims.find((c) => c.id === "c1")!.status).toBe("source_supported");
  });

  it("AT-05: invented quotes and source IDs are stripped and need review", async () => {
    const d = draft({}, [
      { id: "c1", fieldPath: "/role", statement: "I designed the prioritization flow.", status: "source_supported", evidence: ev("I led a team of ten engineers") },
      { id: "c2", fieldPath: "/summary", statement: "A study planner prototype.", status: "source_supported", evidence: ev("study-planner prototype", "33333333-3333-4333-8333-333333333333") },
    ]);
    const out = await generateDraft(new FixtureProvider([JSON.stringify(d)]), baseInput);
    for (const id of ["c1", "c2"]) {
      const c = out.result.claims.find((x) => x.id === id)!;
      expect(c.evidence).toEqual([]);
      expect(c.status).toBe("needs_review");
    }
  });

  it("never accepts model-set user_confirmed and adds claims for uncovered statements", async () => {
    const d = draft({ problem: "Students juggle deadlines." }, [
      { id: "c1", fieldPath: "/role", statement: "I designed the prioritization flow.", status: "user_confirmed", confirmedAt: "2026-01-01", evidence: ev("designed the prioritization flow myself") },
    ]);
    const out = await generateDraft(new FixtureProvider([JSON.stringify(d)]), baseInput);
    const role = out.result.claims.find((c) => c.id === "c1")!;
    expect(role.status).toBe("source_supported");
    expect(role.confirmedAt).toBeUndefined();
    expect(out.result.claims.find((c) => c.fieldPath === "/problem")?.status).toBe("needs_review");
  });

  it("strips model-supplied links and unowned assets", async () => {
    const d = draft({ publicLinks: [{ label: "demo", url: "https://evil.example" }], assetIds: ["44444444-4444-4444-8444-444444444444"] });
    const out = await generateDraft(new FixtureProvider([JSON.stringify(d)]), baseInput);
    expect(out.result.content.publicLinks).toEqual([]);
    expect(out.result.content.assetIds).toEqual([]);
  });

  it("drops claims pointing at nonexistent fields", async () => {
    const d = draft({}, [{ id: "c1", fieldPath: "/outcomes/5/text", statement: "x", status: "needs_review", evidence: [] }]);
    const out = await generateDraft(new FixtureProvider([JSON.stringify(d)]), baseInput);
    expect(out.result.claims.some((c) => c.id === "c1")).toBe(false);
  });
});

describe("generateDraft retry policy", () => {
  it("repairs invalid output once", async () => {
    const p = new FixtureProvider(["{not json", JSON.stringify(draft())]);
    const out = await generateDraft(p, baseInput);
    expect(p.calls).toHaveLength(2);
    expect(out.usage).toHaveLength(2);
  });

  it("fails clearly when repair is still invalid", async () => {
    const p = new FixtureProvider(["{}", JSON.stringify({ content: {} })]);
    await expect(generateDraft(p, baseInput)).rejects.toMatchObject({ code: "invalid_output" });
    expect(p.calls).toHaveLength(2);
  });

  it("retries one transient provider error, then gives up", async () => {
    const rate = () => new ProviderError("rl", "rate_limited", true);
    const ok = await generateDraft(new FixtureProvider([rate(), JSON.stringify(draft())]), baseInput);
    expect(ok.usage).toHaveLength(1);
    await expect(generateDraft(new FixtureProvider([rate(), rate()]), baseInput)).rejects.toBeInstanceOf(GenerationError);
  });

  it("never exceeds three provider invocations", async () => {
    const p = new FixtureProvider([new ProviderError("x", "unavailable", true), "bad", "bad", JSON.stringify(draft())]);
    await expect(generateDraft(p, baseInput)).rejects.toMatchObject({ code: "invalid_output" });
    expect(p.calls.length).toBeLessThanOrEqual(3);
  });

  it("rejects oversized input without calling the provider", async () => {
    const p = new FixtureProvider([]);
    const big = { ...baseInput, chunks: [{ id: CHUNK, sourceId: SRC, text: "a".repeat(80_001) }] };
    await expect(generateDraft(p, big)).rejects.toMatchObject({ code: "input_too_large" });
    expect(p.calls).toHaveLength(0);
  });
});

describe("evidence helpers", () => {
  it("resolves JSON pointers", () => {
    const c = draft({ approach: ["a", "b"] }).content;
    expect(resolvePointer(c, "/approach/1")).toBe("b");
    expect(resolvePointer(c, "/approach/2")).toBeUndefined();
    expect(resolvePointer(c, "/__proto__")).toBeUndefined();
  });
  it("matches quotes exactly modulo whitespace", () => {
    expect(quoteMatches("study-planner   prototype", chunkText)).toBe(true);
    expect(quoteMatches("study planner prototype", chunkText)).toBe(false);
  });
});

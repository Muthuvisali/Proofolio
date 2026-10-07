// Server-owned truthfulness checks for AI drafts (PRD §FR-05, §7).
// The model only *proposes* claim statuses; this module decides the final ones.
import type { Claim, DraftResult, ProjectContent } from "@/schemas/content";

export interface ChunkRef {
  id: string;
  sourceId: string;
  text: string;
}

export interface ValidationContext {
  chunks: ChunkRef[];
  /** Asset IDs the owner explicitly selected for this project. */
  allowedAssetIds?: string[];
  /** Links the owner explicitly approved for publication. */
  approvedLinks?: ProjectContent["publicLinks"];
}

/** Resolve an RFC 6901 JSON pointer. Returns undefined when the path does not exist. */
export function resolvePointer(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) return undefined;
  let node: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(key) || Number(key) >= node.length) return undefined;
      node = node[Number(key)];
    } else if (node && typeof node === "object" && Object.hasOwn(node, key)) {
      node = (node as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return node;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Exact-substring match, tolerant only of whitespace differences. */
export function quoteMatches(quote: string, chunkText: string): boolean {
  const q = squash(quote);
  return q.length > 0 && squash(chunkText).includes(q);
}

// Words that indicate an outcome is a goal, plan or unmeasured expectation.
const UNACHIEVED =
  /\b(target(?:ed|ing|s)?|goal|aim(?:s|ed)?|plan(?:s|ned)?|hope|expect(?:ed|s)?|would|could|projected|estimate[ds]?|not (?:yet )?(?:been )?(?:tested|measured|validated)|untested|haven'?t|hasn'?t|no (?:usability )?(?:study|test|data))\b/i;
const NUMBER = /\d+(?:\.\d+)?\s*(?:%|x\b|percent)?/gi;

/** Text leaves that count as factual statements and therefore need a claim. */
export function factualPaths(content: ProjectContent): string[] {
  const paths: string[] = [];
  const add = (path: string, value: string | undefined) => value?.trim() && paths.push(path);
  add("/summary", content.summary);
  add("/problem", content.problem);
  add("/role", content.role);
  content.approach.forEach((v, i) => add(`/approach/${i}`, v));
  content.decisions.forEach((d, i) => {
    add(`/decisions/${i}/choice`, d.choice);
    add(`/decisions/${i}/reason`, d.reason);
  });
  content.deliverables.forEach((v, i) => add(`/deliverables/${i}`, v));
  content.outcomes.forEach((o, i) => add(`/outcomes/${i}/text`, o.text));
  content.lessons.forEach((v, i) => add(`/lessons/${i}`, v));
  return paths;
}

/**
 * Normalise a schema-valid model draft into a result the server can trust:
 * - drops claims pointing at missing fields;
 * - removes evidence with unknown source/chunk IDs or non-matching quotes;
 * - never lets the model set `user_confirmed` or confirmation timestamps;
 * - flags "observed" outcomes that look like targets or cite numbers absent from evidence;
 * - adds `needs_review` claims for uncovered factual statements;
 * - strips unapproved links and unowned asset IDs.
 */
export function validateDraft(draft: DraftResult, ctx: ValidationContext): DraftResult {
  const chunks = new Map(ctx.chunks.map((c) => [c.id, c]));
  const warnings = [...draft.warnings];
  const allowedAssets = new Set(ctx.allowedAssetIds ?? []);

  const content: ProjectContent = {
    ...draft.content,
    publicLinks: ctx.approvedLinks ?? [],
    assetIds: draft.content.assetIds.filter((id) => allowedAssets.has(id)),
  };

  const claims: Claim[] = [];
  const seenIds = new Set<string>();
  for (const claim of draft.claims) {
    const value = resolvePointer(content, claim.fieldPath);
    if (typeof value !== "string") {
      warnings.push(`Dropped a claim that pointed at a missing field (${claim.fieldPath}).`);
      continue;
    }
    const evidence = claim.evidence.filter((e) => {
      const chunk = chunks.get(e.chunkId);
      return chunk && chunk.sourceId === e.sourceId && quoteMatches(e.quote, chunk.text);
    });
    const statementMatchesField = squash(claim.statement) === squash(value) || squash(value).includes(squash(claim.statement));
    let id = claim.id;
    while (seenIds.has(id)) id = `${claim.id}-${seenIds.size}`;
    seenIds.add(id);
    claims.push({
      id,
      fieldPath: claim.fieldPath,
      statement: claim.statement,
      evidence,
      // The model may only propose support; confirmation is owner-only.
      status: evidence.length > 0 && statementMatchesField ? "source_supported" : "needs_review",
    });
  }

  // Outcome guard: an "observed" outcome must not rest on goal/plan language or unseen numbers.
  content.outcomes.forEach((outcome, i) => {
    if (outcome.kind !== "observed") return;
    const path = `/outcomes/${i}/text`;
    const related = claims.filter((c) => c.fieldPath === path);
    const quotes = related.flatMap((c) => c.evidence.map((e) => e.quote)).join(" \n ");
    const numbers = outcome.text.match(NUMBER) ?? [];
    const unseenNumber = numbers.some((n) => !squash(quotes).includes(squash(n)));
    const goalLanguage = UNACHIEVED.test(quotes);
    if (related.length === 0 || unseenNumber || goalLanguage) {
      related.forEach((c) => (c.status = "needs_review"));
      warnings.push(
        `Outcome "${outcome.text.slice(0, 80)}" is labeled as observed but the evidence ${
          goalLanguage ? "describes a goal or untested expectation" : "does not show this result"
        }. Confirm it or relabel it as proposed.`,
      );
    }
  });

  // Every factual statement needs a claim entry; uncovered ones start as needs_review.
  const covered = new Set(claims.map((c) => c.fieldPath));
  for (const path of factualPaths(content)) {
    if (covered.has(path)) continue;
    claims.push({
      id: `auto-${path.slice(1).replace(/\//g, "-")}`,
      fieldPath: path,
      statement: String(resolvePointer(content, path)),
      status: "needs_review",
      evidence: [],
    });
  }

  return { content, claims, missingInformation: draft.missingInformation, warnings: warnings.slice(0, 10) };
}

/** Claims that block publication for the given content. */
export function unresolvedClaims(content: ProjectContent, claims: Claim[]): Claim[] {
  return claims.filter((c) => c.status === "needs_review" && resolvePointer(content, c.fieldPath) !== undefined);
}

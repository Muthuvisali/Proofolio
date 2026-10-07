// Shared runtime schemas for project content, claims and AI draft results (PRD §7).
// Used by web handlers, the worker and MCP tools; unknown keys are rejected everywhere.
import { z } from "zod";

export const PROJECT_TYPES = ["product_case_study", "technical_project", "ai_system", "general"] as const;
export const PROJECT_STAGES = ["concept", "prototype", "tested", "launched"] as const;
export const OUTCOME_KINDS = ["observed", "proposed", "not_measured"] as const;
export const CLAIM_STATUSES = ["source_supported", "user_confirmed", "needs_review"] as const;

export const ProjectType = z.enum(PROJECT_TYPES);
export const ProjectStage = z.enum(PROJECT_STAGES);
export const OutcomeKind = z.enum(OUTCOME_KINDS);
export const ClaimStatus = z.enum(CLAIM_STATUSES);

const text = (max: number) => z.string().trim().max(max);
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max);

export const PublicLink = z.strictObject({
  label: text(80).min(1),
  url: z.string().max(2048).regex(/^https?:\/\//i, "Only http(s) links are allowed"),
});

export const ProjectContent = z.strictObject({
  schemaVersion: z.literal(1),
  title: text(100).min(1),
  summary: text(240).min(1),
  projectType: ProjectType,
  projectStage: ProjectStage,
  problem: text(2000),
  role: text(1200),
  approach: list(text(600), 8),
  decisions: list(
    z.strictObject({ choice: text(500), reason: text(500), tradeoff: text(500).optional() }),
    5,
  ),
  deliverables: list(text(300), 8),
  outcomes: list(z.strictObject({ id: z.string().min(1).max(64), text: text(500), kind: OutcomeKind }), 6),
  lessons: list(text(500), 5),
  nextSteps: list(text(300), 5),
  skills: list(text(50), 12),
  publicLinks: list(PublicLink, 5),
  assetIds: list(z.uuid(), 3),
});
export type ProjectContent = z.infer<typeof ProjectContent>;

export const Evidence = z.strictObject({
  sourceId: z.string().min(1),
  chunkId: z.string().min(1),
  quote: z.string().min(1).max(600),
});
export type Evidence = z.infer<typeof Evidence>;

export const Claim = z.strictObject({
  id: z.string().min(1).max(64),
  fieldPath: z.string().startsWith("/").max(200),
  statement: z.string().min(1).max(2000),
  status: ClaimStatus,
  evidence: list(Evidence, 5),
  confirmedAt: z.string().optional(),
});
export type Claim = z.infer<typeof Claim>;

export const MissingInformation = z.strictObject({
  fieldPath: z.string().startsWith("/").max(200),
  question: text(300).min(1),
});

export const DraftResult = z.strictObject({
  content: ProjectContent,
  claims: z.array(Claim).max(60),
  missingInformation: list(MissingInformation, 3),
  warnings: list(text(300), 10),
});
export type DraftResult = z.infer<typeof DraftResult>;

export const MAX_DRAFT_BYTES = 40 * 1024;

export function emptyContent(title = "Untitled project"): ProjectContent {
  return {
    schemaVersion: 1,
    title,
    summary: title,
    projectType: "general",
    projectStage: "concept",
    problem: "",
    role: "",
    approach: [],
    decisions: [],
    deliverables: [],
    outcomes: [],
    lessons: [],
    nextSteps: [],
    skills: [],
    publicLinks: [],
    assetIds: [],
  };
}

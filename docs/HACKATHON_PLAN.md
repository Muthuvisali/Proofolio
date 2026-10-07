# Proofolio — Nebius x NVIDIA Global AI Hackathon plan

Source of truth for scope remains `Proofolio_Demo_PRD.md`. This file records how the PRD maps to the hackathon and the order of work.

## Hackathon constraints → product decisions

| Hackathon requirement | How Proofolio meets it |
|---|---|
| Use Nebius Token Factory or AI Cloud | All live drafting goes through Nebius Token Factory (OpenAI-compatible API, `src/ai/nebius.ts`). |
| Use at least one NVIDIA open model | Drafting uses an NVIDIA Nemotron model (`NEBIUS_MODEL`, chosen via `npm run nebius:models`). |
| Working demo URL | Public HTTPS deployment of web + MCP + worker (host TBD). |
| ≤3-minute YouTube video | Based on PRD §22 script; recorded against the live deployment, no simulated connections. |
| Public repo, OSI license, README | MIT `LICENSE`; README with setup and implementation details. |
| Pre-existing work disclosure | Repository started 2026-10-01, inside the submission period. PRD/handoff docs were written beforehand; code was not. |
| Deadline | **2026-10-30, 10:00 AM PDT**. Internal target: submit 2026-10-29. |

Suggested track: **Best Apps and Agents** (consumer app plus an MCP agent integration). **Personal AI** is the alternative: it frames Proofolio as a persistent memory of your work.

## Why this is a strong technical story for judges

1. **Nemotron does structured, evidence-grounded drafting.** The model must cite verbatim quotes per claim. The server (`src/domain/evidence.ts`) re-checks every quote, source ID and field pointer, so the model cannot certify itself.
2. **An honesty guard against AI embellishment.** "Observed" outcomes that rest on goal or untested language, or that cite numbers missing from the evidence, are forced into review. A "target 20%, not tested" source cannot be published as "reduced by 20%".
3. **Remote MCP with real OAuth.** Users save work from Claude or ChatGPT into their private drafts. Publishing stays a human-reviewed web action.

Possible enhancement if time allows (this is a PRD deviation that needs an owner decision): use a smaller Nemotron model (Nano) as a fast second-pass "claim auditor" next to the deterministic checks, within the 3-invocation cap.

## Build order (≈4 weeks)

| Window | Milestone | Exit check |
|---|---|---|
| Oct 1–3 | Core contracts: schemas, evidence validator, Nebius adapter, tests ✅ (unit-tested with fixtures) | Live Nemotron JSON-schema call works with a real key |
| Oct 2–8 | **M0**: Supabase local and hosted, Google sign-in, Supabase OAuth server, `/mcp` with `get_profile`, grant revocation | Real Claude connector calls `get_profile`; revoked grant rejected |
| Oct 8–14 | **M1**: landing, `/demo` sample, onboarding, projects, editor, previews, atomic publish, public pages, unpublish, RLS | Two users publish independently; no cross-access |
| Oct 14–20 | **M2**: capture (paste/.txt/.md), chunks, durable job table plus worker, evidence panel, candidate revisions, quotas, manual fallback | Real Nemotron draft end to end; browser close doesn't lose jobs |
| Oct 20–24 | **M3**: full MCP tool set on shared domain services, consent page, connections page, compatibility record | Claude saves work and starts a draft visible in the web app |
| Oct 24–28 | **M4 (trimmed)**: static export, image upload, delete/deletion worker, feedback/report, a11y and mobile pass, deploy docs | Acceptance checklist filled with real results |
| Oct 28–29 | Video, README, Devpost write-up, submit | Submitted before deadline |

### Hackathon cut line

These PRD P0 items are scheduled last and may slip. If they slip, they are recorded as **Not started/Deferred** in the release checklist and never claimed:
rollback previews, profile drafting from résumé text (`profile_candidates`), operator abuse-removal command, analytics operator report, ChatGPT host verification.

These items are not cut: auth and RLS isolation, exact-snapshot publishing, the proposed-vs-observed guard, a real Nemotron call, at least one real MCP host, and the anonymous sample.

## External prerequisites (owner action required)

| Item | Needed by | Status |
|---|---|---|
| Nebius Token Factory API key (in `.env.local` only) | Live generation, M0 smoke | Pending |
| Supabase project (hosted) and OAuth server enabled | M0 | Pending; local dev via `npx supabase start` (Docker) |
| Google OAuth client (redirect URLs) | Public sign-in | Pending |
| Hosting with HTTPS for web + worker (container-capable) | MCP host test, demo URL | Pending decision |
| Claude account able to add a custom connector | AT-07 | Pending |
| Public GitHub repo | Submission | Pending |
| Support contact | Privacy/support pages | Pending |

## Risks

- **Supabase OAuth server + MCP audience binding** is the riskiest integration. It is spiked first (M0). If the binding can't be enforced, a documented compatible managed issuer is used instead; OAuth is not hand-rolled.
- **Nemotron JSON-schema adherence**: covered by the repair attempt and strict validation. Model choice is confirmed with a fixture evaluation (PRD §17) before the demo.
- **Repo inside OneDrive**: syncing `node_modules`/`.next` can cause file-lock errors on Windows. Move the repo outside OneDrive if builds start failing with EPERM/EBUSY.

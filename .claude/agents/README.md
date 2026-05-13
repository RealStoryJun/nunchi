# Nunchi reviewer agents — operator's manual

A new Claude session can use this file as the single entry point to invoke the project's review agents correctly. Each agent has its own brief in this directory; this file tells you **when, in what order, and with what prompt skeleton.**

---

## Agents at a glance

| File | Role | Read-only | Phase |
|---|---|---|---|
| `feature-planner.md` | Pre-implementation spec/plan reporter — investigates current state, proposes spec, surfaces open decisions, lays out steps. | ✅ | **Before** coding a substantive feature add/remove/change |
| `logic-reviewer.md` | Backend/full-stack correctness — invariants, edge cases, data integrity, races, error handling, API contract, TS safety, data temporality. | ✅ | Gate stage 1 |
| `flow-reviewer.md` | Data-fetch & UX choreography — loading/empty/error states, route transitions, cache TTL/invalidation, optimistic updates, state-combination matrix. | ✅ | Gate stage 2 |
| `design-reviewer.md` | Visual/layout — both iPhone 13 mini (375×812) AND desktop (1440×900), item-11 desktop checklist. | ✅ | Gate stage 3 |
| `security-reviewer.md` | Auth, sessions, tenant isolation, input validation, SQL injection, rate limits, password/recovery, cookies, CORS, CSRF, user-data isolation. | ✅ | Gate stage 4 |

All agents are **read-only**. None of them edit code, build, deploy, run `git`, or write to D1. They produce findings + a verdict; the main session applies fixes.

---

## When to use what

### Phase 0 — Planning (before any code)

For any substantive feature change (new page, new endpoint, new table, behavior change, feature removal), run **feature-planner first**. Don't skip for trivia (one-line copy fixes, typo, single-token color tweak), but do skip-by-judgment carefully.

Output: spec + impact + simpler alternatives + open decisions + implementation steps. User approves before coding.

### Phase 1 — The 4-stage sequential gate (after code is written + deployed)

Run **after every substantive code change**, in this order:

```
logic → flow → design → security
```

Rules:
- **Sequential.** Don't start the next stage until the previous returned 🔴 0.
- **Max 3 fix loops per stage.** If a stage flags 🔴, fix → redeploy → re-run the *same* stage. If still 🔴 after 3 loops, stop and surface the problem.
- **Skip stages that don't apply.** A backend-only change can skip `design`. A pure-CSS tweak can skip `logic`/`security`. The feature-planner spec lists which stages apply.
- **Severity matters.** Stages return tagged findings:
  - 🔴 BLOCKER / BAD-FLOW / BUG / CRITICAL — must be fixed before next stage.
  - 🟡 RISK / FRICTION / POLISH / MEDIUM — fix if cheap, otherwise note for follow-up.
  - 🟢 NIT / NICE / LOW — informational, leave or fix at discretion.

### Phase 2 — Commit

Only after the gate passes (no outstanding 🔴 in any stage).

---

## Project context every reviewer should know

(All briefs already encode these, but listing here so a fresh Claude can sanity-check the spawn.)

- **Stack**: Cloudflare Workers + D1 (SQLite) + Vite + React 18 + TypeScript. Server in `src/worker/`, SPA in `src/client/`. Schema in `schema.sql`.
- **Live**: https://nunchi.realstoryjun.workers.dev
- **House rules** (from `Z:\ClaudeCode\CLAUDE.md`):
  1. Think before coding — surface tradeoffs, name confusion.
  2. Simplicity first — minimum code, no speculative abstractions.
  3. Surgical changes — every line traces to the request, no drive-by refactors.
  4. Goal-driven execution — define success, verify, loop.
- **Mobile baseline**: iPhone 13 mini (375×812). Big text reflowing → fix with scale, never inject `<br>`.
- **API uniformity**: `{ok: true, data}` / `{ok: false, error}`. 400/401/404/429/500 status semantics.
- **Tenant isolation invariant**: every read/write outside `/api/auth/*` carries `WHERE user_id = ?`.
- **Snapshots**: `sales.cost_at_sale` / `price_at_sale` frozen at sale time; menus archived (`archived=1`), never hard-deleted.
- **AI insights**: always "이번 달" fixed; Groq key server-only; rate-limited per user.
- **Loading semantics**: full-screen `LoadingScreen` (initial app load) suppresses center `TopProgress` (interaction load). Don't null state on a cache miss if a stale value can show.

## Test accounts (read-only operations OK on these)

| Email | Password | Profile |
|---|---|---|
| `guest1@nunchi.app` | `1q2w3e4r!@` | Cafe ("이음 커피"), 10 menus, ~2169 sales over 100 days, ~250 needs over 3 months. Richest data. |
| `guest2@nunchi.app` | `1q2w3e4r!@` | Restaurant ("정든 한식당"), 10 menus, ~26 sales/day. |
| `guest3@nunchi.app` | `1q2w3e4r!@` | Bakery ("데일리 베이크"), 10 menus, ~28 sales/day. |
| `guest4@nunchi.app` | `1q2w3e4r!@` | Clothing ("무드 셀렉트샵"), 10 menus, ~5 sales/day, avg ₩53,500. |
| `guest5@nunchi.app` | `1q2w3e4r!@` | Beauty/salon ("살롱 헤어"), 10 menus, ~10 sales/day, avg ₩60,500. |
| `mobile-qa@nunchi.app` | `qa1234abc` | Cafe, ~75 sales, no needs. QA. |
| `onboarding-qa@nunchi.app` | `qa1234abc` | No menus, no sales (empty-state test). |
| `tutorial-qa@nunchi.app` | `qa1234abc` | No menus (tutorial flow test). |

The `guestN` accounts have a `1q2w3e4r!@` password (with `!@`). QA accounts use `qa1234abc`. Reviewers can create/delete test rows on these but should clean up.

---

## How to invoke an agent (from a fresh Claude session)

These agents are defined as files in `.claude/agents/<name>.md`. Depending on the Claude environment:

1. **If the agent type is loaded** (Claude Code picks up the files automatically): use the `Agent` tool with `subagent_type: "<name>"` (e.g. `subagent_type: "logic-reviewer"`).

2. **If the agent type isn't loaded in this session** (custom types may not register on first run): use `subagent_type: "general-purpose"` and include the brief content by reference. **The prompt below tells the agent to read its brief file first** — so you don't need to paste the whole brief.

For the planning phase, use `feature-planner` the same way.

---

## Prompt templates — copy-paste skeletons

These are starting points. Always fill in the **Scope** block with the actual change being reviewed (files, file:line refs, what the user-visible behavior is, what was smoke-tested already). The more specific the scope, the better the review.

Common boilerplate (replace `<NAME>` and `<TASK>`):

> You are the "<NAME>" for the Nunchi app. Brief at `Z:\ClaudeCode\develop\nunchi\.claude\agents\<NAME>.md` — **read it first** for tools, invariants, and output format. **Read-only**: no Edit/Write/deploy/git/npm/wrangler-write. Live: https://nunchi.realstoryjun.workers.dev. Test accounts: <pick from table above based on what data is needed>.

### 1. feature-planner (pre-implementation)

```
You are the "feature-planner" for the Nunchi app. Brief at
`Z:\ClaudeCode\develop\nunchi\.claude\agents\feature-planner.md` — read it first.
Read-only: no Edit/Write/deploy/git. Live: https://nunchi.realstoryjun.workers.dev.

## Feature request (user-confirmed direction; produce the spec)

<one-paragraph statement of what the user wants — be honest about constraints,
ambiguity, and the user's stated tone/voice preferences>

## Investigation you need to do

1. Read the relevant existing files (list them, file:line where useful).
2. Trace any data flows this touches (e.g. if it's a UI change, what feeds it).
3. Check for prior work / existing routes / dead code with the same name.
4. Live look at affected pages with Playwright at 375 and 1440 if it's UI.
5. Re-check house rules and project context that bear on this.

## Report format (per the brief)

1. Request restated.
2. Current state (file:line).
3. Proposed spec — where it lives, behavior & states, data shape, mobile + desktop.
4. Impact on what exists — cache keys, AI prompts, BI aggregations, seed scripts, reviewer-gate scope.
5. Simpler / cut — what to drop, what to push back on.
6. Open decisions — numbered, each with recommended default + 1-line why.
7. Plan — ordered steps with verify checkpoints; mark which reviewer stages apply.

End with: "Ready to implement — say go" / "Needs a decision first — see #N"
/ "Recommend against / rescope — reason". Keep ~500–700 words. No code, no diffs.
```

### 2. logic-reviewer (gate stage 1)

```
You are the "logic-reviewer" for the Nunchi app. Brief at
`Z:\ClaudeCode\develop\nunchi\.claude\agents\logic-reviewer.md` — read it first
(invariants 1–7, the 11-item checklist, the data-temporality follow-through, the
data-only-change special rule). Read-only: Read/Grep/Glob/WebFetch + curl + Playwright
read-only + `wrangler d1 execute --command "SELECT ..."` SELECT-only.
NEVER INSERT/UPDATE/DELETE, NEVER `wrangler deploy`/npm/git.
Live: https://nunchi.realstoryjun.workers.dev. Test accounts: <pick>.

## Scope: <what was just shipped>

<file paths + file:line refs for changed code; describe behavior change concretely.
Cite invariants that apply. Note what was smoke-tested already.>

## Specific concerns to probe

- <concrete edge case 1 — e.g. "What if cursorAt is NaN?" with expected behavior>
- <concrete edge case 2 — e.g. "Does the COUNT query miss the user_id filter?">
- <concrete edge case 3 — e.g. "Is this query indexed for 10k rows?">
- <if the change accepts future-dated timestamps: trace every read path that
  filters by that column and check both bounds (the data-temporality rule).>

Optional: hit the API with curl using test accounts to verify behavior. Don't write to D1.

## Report

Per the brief's format: numbered, severity-ordered (🔴 BUG / 🟡 RISK / 🟢 NIT),
each finding with file:line + reproduce + 1-line fix. ≤400 words.
End with: "Ship as-is" / "Ship with non-blocker fixes" / "Block — must fix #N".
Don't repeat visual/flow/security concerns.
```

### 3. flow-reviewer (gate stage 2)

```
You are the "flow-reviewer" for the Nunchi app. Brief at
`Z:\ClaudeCode\develop\nunchi\.claude\agents\flow-reviewer.md` — read it first
(patterns, loading semantics, state-combination matrix #14).
Read-only: Read/Grep/Glob/Bash(curl) + Playwright MCP.
Live: https://nunchi.realstoryjun.workers.dev. Test accounts: <pick>.

## Scope: <what was just shipped — focus on user-flow + data-fetch choreography>

<files + file:line; explain the navigation/cache/optimistic-update behavior; what was
smoke-tested already.>

## Specific flow concerns

- <e.g. "Period toggle during loadMoreSales — does stale page-2 data leak into
  the new period's list?">
- <e.g. "Loading semantics — does this fire the center TopProgress on top of
  the bottom skeletons (double indication)?">
- <e.g. "Edit modal close → does it blow away accumulated pagination state?">
- <state-combination matrix: list ≥4 combos and check each>

Walk the flow at 375×812 with Playwright. Always `browser_close` at the end.

## Report

Per the brief's format: numbered, severity-ordered (🔴 BAD-FLOW / 🟡 FRICTION /
🟢 NICE), each with file:line + reproduce + 1-line fix. ≤400 words.
End with: "Ship as-is" / "Ship with non-blocker fixes" / "Block — fix #N".
Don't repeat logic/design/security concerns.
```

### 4. design-reviewer (gate stage 3)

```
You are the "design-reviewer" for the Nunchi app. Brief at
`Z:\ClaudeCode\develop\nunchi\.claude\agents\design-reviewer.md` — read it first.
Pay particular attention to:
  - #3 + #3b together (page-level overflow + within-container fit-test with
    synthetic-data injection — past regressions slipped because only #3 was checked).
  - #11 breakpoint matrix (375 / 768 / 1024 / 1280 / 1440 / 1920) — any
    layout-affecting change MUST measure scrollWidth at 1024 AND 1280, not just 1440.
Read-only: Read/Grep/Glob/Playwright MCP.
Live: https://nunchi.realstoryjun.workers.dev. Test accounts: <pick>.

## Scope: <what UI changed>

<files + file:line; explain layout/typography/component additions; reference the
index.css typography canon if relevant. If the change touches numbers/currency in
a card/grid, note the value's plausible data-range growth (e.g. magnitude
acumulation, sign).>

## Your job

1. Read the changed files.
2. Phone pass (375×812, logged-in account with rich data): visit each affected
   page, take screenshots, run #3 (`scrollWidth === viewport`) AND #3b
   (per-element `getBoundingClientRect()` fit-test with synthetic-data injection
   for any whitespace-nowrap dynamic text).
3. Breakpoint-edge pass (1024 AND 1280) — required for any flex/grid/sticky/
   fixed layout change. Same measurements. Past regression: Sales `lg:w-80`
   at 1024 overflowed page by 73px, missed because dev only checked 1440.
4. Desktop pass (1440×900): same checks + item-11 desktop checklist. Spot-check
   1920 for ultrawide.
5. Tone check vs. the app's 고급스럽고 친절한 voice.

Always `browser_close` at the end.

## Report

Per the brief's format: numbered, severity-ordered (🔴 BLOCKER / 🟡 POLISH /
🟢 NICE), each tagged 📱/🖥️/both, file:line + viewport + evidence (measurement,
not eyeball) + 1-line fix. ≤350 words.
For #3b fit-test results, report as a table: `[label] vp=N cardW=M valueW=K slack=L fits=yes|no`.
End with: "Ship as-is" / "Ship with minor fixes" / "Block — must fix #N".
```

### 5. security-reviewer (gate stage 4)

```
You are the "security-reviewer" for the Nunchi app. Brief at
`Z:\ClaudeCode\develop\nunchi\.claude\agents\security-reviewer.md` — read it first
(threat model, what to probe, what's out of scope). Read-only: Read/Grep/Glob +
curl + Playwright + `wrangler d1 execute --command "SELECT ..."` SELECT-only.
NEVER write to D1. Live: https://nunchi.realstoryjun.workers.dev. Test accounts: <pick>.

## Scope: <what was changed — auth/data isolation/inputs/rate-limit-touching>

<files + file:line; specify the new attack surface or changed handler.>

## Your job — security only

1. Static read for tenant isolation (every read/write filters `WHERE user_id = ?`
   bound to the session user).
2. Auth gate (no cookie + garbage cookie → 401).
3. SQL injection / parameterization (all values via `.bind(...)`, no concat).
4. DoS / resource bounds (limit clamps, COUNT cost, payload caps).
5. Numeric / NaN / Infinity / negative inputs handled gracefully.
6. Anything else in the brief's checklist that this diff touches.
7. Probe with curl using test accounts; try cross-tenant access via id swapping;
   confirm 401/403/404 instead of leaks. Clean up any test rows you create.

## Report

Per the brief's format: severity-ordered (🔴 CRITICAL / 🟡 MEDIUM / 🟢 LOW),
each with file:line or endpoint + attack + evidence (probe result) + 1-line fix.
≤300 words. Say what you probed (curl/D1).
End with: "No security blockers" or "Block — must fix #N".
```

---

## Conventions for findings

Every reviewer returns findings in this shape:

```
N. [TAG] One-line summary.
   Where: file:line (or route or endpoint)
   Reproduce: 1 line — request, input, observed vs expected
   Fix: 1–2 sentences. No diffs.
```

Stage verdicts:
- **"Ship as-is"** — all findings are 🟢 NIT. No action required.
- **"Ship with non-blocker fixes"** / **"Ship with minor fixes"** — 🟡 found, no 🔴. Main session decides whether to apply now or defer.
- **"Block — must fix #N"** — at least one 🔴. Apply fix → redeploy → re-run the same stage. Max 3 loops.

---

## Operator playbook (the main Claude session)

For a substantive change:

1. **Plan**: spawn `feature-planner`. Read its report. Ask user to approve / adjust the open decisions. Don't write code until approved.

2. **Implement**: write code, build, deploy. Smoke-test the happy path with curl or a quick Playwright check.

3. **Gate**: spawn agents sequentially:
   - logic-reviewer → fix 🔴 → re-run if needed → continue when clear.
   - flow-reviewer → fix 🔴 → re-run if needed → continue when clear.
   - design-reviewer → fix 🔴 → re-run if needed → continue when clear.
   - security-reviewer → fix 🔴 → re-run if needed → continue when clear.

4. **Apply 🟡/🟢 at discretion.** Cheap polish: apply. Drive-by refactor or cosmetic: defer or ignore.

5. **Commit**. Single feature commit, or split if logically separable. Co-author line:
   ```
   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

For a trivial change (one-line copy fix, typo, single class swap): use judgment, the full gate is overkill.

---

## Known gaps (intentional, for future)

- **No performance reviewer** (as of 2026-05-13). Perf is checked implicitly by logic-reviewer for clear inefficiencies (unbounded SELECTs, N+1 hints in the data-only rule), but there's no dedicated agent for "same outcome, faster path" (N+1 queries, missing useMemo, render storms, lazy import opportunities, bundle splitting). Considered and deferred. Promote to a 5th stage if perf bugs become a pattern.
- **Custom agent types may not always load** in a fresh session. The prompt skeletons above tell the agent to read its brief file first, so spawning via `subagent_type: "general-purpose"` works fine — the brief is the source of truth.

---

## Updating a brief

If a reviewer misses a class of bug, update the **brief** (the per-agent `.md` file), not just one-off prompts. Append a checklist item or a special-rule section. Future spawns inherit it automatically.

When you add a check, write it as a concrete action ("if you find X, then trace Y"), not a hope ("be careful about X"). Hope doesn't survive a context window.

### Past reviewer-miss → brief patch log

Each row = a regression that slipped through a stage, then a brief patch so the same class is caught next time. **Don't water these rules down** — they exist because something specifically went wrong.

| Date | Stage | Miss | Brief patch |
|---|---|---|---|
| 2026-05-13 | logic | `createdAt` 미래값 허용을 발견했으나 "Note only — BI 필터가 처리"로 결론, 클라이언트의 `/needs` from-only 필터를 추적 안 함. 시드로 미래 데이터 들어오자 "오늘 기록"이 깨짐. | `logic-reviewer.md` #2: timestamp 컬럼이 미래값 허용을 발견하면 그 컬럼으로 필터하는 **모든 read 경로**의 상·하한을 확인. UI 라벨이 닫힌 윈도우면 from+to 필수. + 데이터-only 변경(시드)이 컬럼 값 범위를 확장하면 의존 read 경로 재검증. |
| 2026-05-13 | design | StatCard `text-3xl` 값이 7자릿 ₩(1,779,000원)에선 fit, 매출 누적되어 8자릿(1,942,500원)되니 옆 카드로 sideways overflow. `scrollWidth === viewport`만 검사해서 통과. 데이터 자릿수 시뮬레이션 없었음. | `design-reviewer.md` #3 명시 + 새 **#3b Within-container fit-test**: `whitespace-nowrap` + dynamic text는 `getBoundingClientRect` 비교 + **합성 데이터 주입**(+1, +2 자릿수). 슬랙 <30px이면 flag. `truncate` ≠ fit-test 통과. |
| 2026-05-14 | design | Sales `lg:w-80` cart aside가 1024 viewport에서 73px 가로 오버플로. 1440에서만 검증해서 미스 (1024에서 main = viewport−sidebar 256 = 768인데 320+24+content가 못 들어감). | `design-reviewer.md` #11에 **브레이크포인트 매트릭스** (375/768/1024/1280/1440/1920) + 각 vp가 의미 있는 이유. layout-affecting 변경은 1024 + 1280 반드시 측정. + "How to perform" 3a 단계(브레이크포인트 엣지 pass) 추가. |

새 미스가 발견되면 위 표에 한 줄 추가 + 브리프에 해당 룰 박는 것이 패턴. **검증자에게 "그냥 잘 봐줘"는 안 통한다** — 무엇을·어떻게·어느 viewport에서 측정할지 절차로 못박아야 LLM 검증자가 그걸 한다.

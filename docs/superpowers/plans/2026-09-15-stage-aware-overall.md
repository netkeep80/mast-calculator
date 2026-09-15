# Stage-aware Project Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one application-owned stage summary the authority for overall project status so requested erection/guy stages cannot be silently dropped from PASS/FAIL/INCOMPLETE.

**Architecture:** Preserve `engineering-summary/v1` and `result-summary/v1` compatibility. Add a new versioned `project-stage-summary/v1` over the immutable `{ result, guyedResult, erectionResult, stageErrors }` snapshot returned by `calculateProjectStages()`, then add `result-summary/v2` for stage-aware machine transport. Web and CLI consume the same stage summary; Desktop inherits the canonical Web application and gets equivalence gates. Optional-stage numerical/convergence failures are captured by the application orchestrator, while cancellation and invalid input still throw.

**Tech Stack:** TypeScript application core, JavaScript Web/CLI adapters, Node test runner, Tauri Desktop build.

**Spec:** GitHub issue #119 — `[P0] Учитывать включённые стадии и невозможный монтаж в общем результате`.

## Global Constraints

- GitHub issue #119 is the requirements authority.
- Preserve existing bare/guyed numerical results and solver formulas.
- Do not invent erection strength/capacity criteria owned by #72.
- `diagnostics.converged` means adaptive sampling convergence only, never physical feasibility.
- `result-summary/v1` and `engineering-summary/v1` keep their published compatibility semantics.
- Any incompatible machine-readable project result uses a new schema version.
- Cancellation, schema/input-validation and unsupported-configuration errors remain fail-fast; only optional-stage numerical/convergence failures become stage outcomes.
- No second solver or adapter-owned engineering status logic.

---

### Task 1: Freeze the stage-status contract with RED tests

**Files:**
- Modify: `tests/headless-api-engineering-summary.test.js`
- Modify: `tests/project-stages-physics-invariants.test.js`

**Interfaces:**
- Consumes: existing `calculateProjectStages()`, `createEngineeringSummary()` and erection envelope fields.
- Produces: executable expectations for `PROJECT_STAGE_SUMMARY_SCHEMA`, `createProjectStageSummary()`, `stageErrors` and exact status mapping.

- [ ] **Step 1: Add contract fixtures to `headless-api-engineering-summary.test.js`**

Add tests that expect:

```js
const summary = createProjectStageSummary({
  result: bare,
  guyedResult: null,
  erectionResult: null,
  stageErrors: { guys: null, erection: null },
}, { requestedGuys: false, requestedErection: false })
assert.equal(summary.schema, PROJECT_STAGE_SUMMARY_SCHEMA)
assert.equal(summary.stages.operational.status, 'passed')
assert.equal(summary.stages.guys.status, 'not-requested')
assert.equal(summary.stages.erection.status, 'not-requested')
assert.equal(summary.overallStatus, 'pass')
```

Also add synthetic fixtures proving the precedence table:

```text
requested stage failed/infeasible -> overall fail
requested stage numerical-error   -> overall incomplete
requested stage pending           -> overall incomplete
all requested stages passed       -> overall pass
```

- [ ] **Step 2: Add real erection fixtures to `project-stages-physics-invariants.test.js`**

Use the existing 2-module project helpers. Add:
- anchor on the hinge node, sweep 31..39 degrees -> `0 feasible`, `>0 infeasible`, stage status `infeasible`, overall `fail`;
- stable erection path -> stage status `pending`, `feasible=true`, `verified=false`, overall cannot be `pass`;
- no erection -> `not-requested`, no change to operational result.

- [ ] **Step 3: Run the classified tests and verify RED**

Run through CI or emitted test runner:

```text
node --test .build/tests/headless-api-engineering-summary.test.js
node --test .build/tests/project-stages-physics-invariants.test.js
```

Expected: failures because `createProjectStageSummary`, schema and `stageErrors` do not exist.

- [ ] **Step 4: Commit the RED contract**

```bash
git add tests/headless-api-engineering-summary.test.js tests/project-stages-physics-invariants.test.js
git commit -m "test: define stage-aware project status contract"
```

---

### Task 2: Add the application-owned stage summary

**Files:**
- Create: `packages/application/src/project-stage-summary.ts`
- Modify: `packages/application/index.ts`
- Modify: `packages/application/src/project-stages.ts`

**Interfaces:**
- Produces:

```ts
export const PROJECT_STAGE_SUMMARY_SCHEMA = 'mast-calculator/project-stage-summary/v1' as const
export type ProjectStageStatus = 'not-requested' | 'pending' | 'numerical-error' | 'infeasible' | 'failed' | 'passed'
export type ProjectOverallStatus = 'pass' | 'fail' | 'incomplete'
export function createProjectStageSummary(
  stages: ProjectStagesResult,
  scope: { requestedGuys: boolean; requestedErection: boolean },
): ProjectStageSummary
```

`ProjectStageSummary.stages` has `operational`, `guys`, `erection`, each with `requested`, `executed`, `feasible: boolean | null`, `verified`, `status`, and optional `reason/code`.

- [ ] **Step 1: Implement status derivation without new engineering formulas**

Rules:

```text
operational: derive from createEngineeringSummary(result)
guys: derive only from existing guyed criteria when requested
erection:
  not requested                         -> not-requested
  numerical/convergence stage error     -> numerical-error
  no envelope / no samples              -> numerical-error
  diagnostics.converged == false        -> numerical-error
  infeasibleSampleCount > 0             -> infeasible
  all sampled states feasible           -> pending (strength acceptance #72 missing)
```

Overall precedence:

```text
failed or infeasible -> fail
numerical-error or pending -> incomplete
otherwise -> pass
```

- [ ] **Step 2: Capture optional-stage numerical failures in `calculateProjectStages()`**

Return an immutable sibling:

```ts
stageErrors: {
  guys: SerializedStageError | null
  erection: SerializedStageError | null
}
```

Catch only `numerical-failure` and `convergence-failure` from optional stages. Re-throw `cancelled`, `input-validation`, `unsupported-configuration`, `schema-error` and internal invariant errors.

- [ ] **Step 3: Export the new contract through `packages/application/index.ts`**

Add only the public application export; adapters must not deep-import it.

- [ ] **Step 4: Run focused tests to GREEN and commit**

Expected: Task 1 tests pass and existing stage equivalence remains unchanged when there are no errors.

```bash
git add packages/application/src/project-stage-summary.ts packages/application/src/project-stages.ts packages/application/index.ts tests/headless-api-engineering-summary.test.js tests/project-stages-physics-invariants.test.js
git commit -m "feat: add stage-aware project status summary"
```

---

### Task 3: Introduce stage-aware machine summary v2 without mutating v1

**Files:**
- Modify: `packages/application/src/result-summary.ts`
- Modify: `tests/headless-api-engineering-summary.test.js`

**Interfaces:**
- Preserve: `RESULT_SUMMARY_SCHEMA = 'mast-calculator/result-summary/v1'` and existing v1 factories.
- Produce:

```ts
export const PROJECT_RESULT_SUMMARY_SCHEMA = 'mast-calculator/result-summary/v2' as const
export function createProjectResultSummary(
  projectPackage: ProjectPackageV2,
  stages: ProjectStagesResult,
  options: ResultSummaryOptions,
): ProjectResultSummaryV2
```

The v2 object contains input scope including `guys` and `erection`, `stageSummary`, operational result payload, optional guy payload and optional erection envelope summary.

- [ ] **Step 1: Add RED tests proving v1 compatibility and v2 scope**

Assert v1 `result.passes` remains byte/semantic compatible, while v2 exposes `overallStatus`, all requested stage statuses and erection configuration.

- [ ] **Step 2: Refactor payload helpers without changing numbers**

Extract reusable bare/guy payload builders from the existing v1 factories, then compose v2 from the same values plus stage summary.

- [ ] **Step 3: Run focused tests to GREEN and commit**

```bash
git add packages/application/src/result-summary.ts tests/headless-api-engineering-summary.test.js
git commit -m "feat: add stage-aware result summary v2"
```

---

### Task 4: Migrate CLI calculate to the stage-aware projection

**Files:**
- Modify: `apps/cli/cli-runtime.mjs`
- Modify: `tests/cli-oracle.test.js`
- Modify: `tests/erection-cli-regression.test.js`

**Interfaces:**
- Consumes: `calculateProjectStages()` + `createProjectResultSummary()`.
- Produces: `calculate --json` with `result-summary/v2`; human calculate output begins with overall status/scope and never prints `OK bare` for a requested impossible erection stage.

- [ ] **Step 1: Add RED CLI fixtures**

Prove:
- singular requested erection -> JSON `overallStatus='fail'`, erection `status='infeasible'`; human output cannot contain `OK bare`/`OK guyed`;
- feasible-but-unverified erection -> `overallStatus='incomplete'`;
- no erection preserves operational metrics.

- [ ] **Step 2: Replace adapter-side mode selection with application summary**

`calculateFromPackage()` returns stages; `calculate` serializes `createProjectResultSummary()`. Human text reads `stageSummary` and may append metrics, but must not recompute status.

- [ ] **Step 3: Run CLI oracle gates and commit**

```bash
git add apps/cli/cli-runtime.mjs tests/cli-oracle.test.js tests/erection-cli-regression.test.js
git commit -m "feat: make CLI calculate stage-aware"
```

---

### Task 5: Migrate Web/desktop presentation to the same stage summary

**Files:**
- Modify: `apps/web/usage-scenarios.js`
- Modify: `apps/web/app-bootstrap.js`
- Modify: `apps/web/result-channel.js` only if snapshot normalization is needed
- Modify: `tests/erection-stage-ui.test.js`
- Modify: `tests/web-application-boundary.test.js`
- Modify: `tests/desktop-equivalence.test.js`

**Interfaces:**
- Consumes: the one stage snapshot already transported by the calculation controller plus `createProjectStageSummary()`.
- Produces: Web headline and scenario status based on the same application projection as CLI; Desktop receives the same behavior from the canonical Web build.

- [ ] **Step 1: Add RED presentation boundary tests**

Assert Web imports/uses `createProjectStageSummary`, passes `erectionResult` and stage errors into status rendering, and does not reconstruct PASS/FAIL from raw envelope fields.

- [ ] **Step 2: Pass full stage snapshot to usage rendering**

Update the result subscription so `enrichAndRenderUsageResult()` receives the complete stage scope/result. Replace each direct `createEngineeringSummary(result, guyResult)` call with one shared stage summary created once for the snapshot.

- [ ] **Step 3: Render stage-aware copy**

For `infeasible`: explicit “монтажная стадия физически недопустима”.
For `pending`: explicit “монтажная геометрия выполнима, но прочность монтажной стадии ещё не проверена”.
For `numerical-error`: explicit inability to issue PASS.
For no erection: existing operational/guy copy remains.

- [ ] **Step 4: Run Web + Desktop adapter gates and commit**

```bash
git add apps/web/usage-scenarios.js apps/web/app-bootstrap.js apps/web/result-channel.js tests/erection-stage-ui.test.js tests/web-application-boundary.test.js tests/desktop-equivalence.test.js
git commit -m "feat: present stage-aware overall status"
```

---

### Task 6: Documentation, negative gates and final verification

**Files:**
- Modify: `docs/architecture/CONTRACTS.md`
- Modify: `tests/contracts.test.js` if a public schema/export guard is required.

**Interfaces:**
- Documents the exact distinction between physical feasibility, numerical sampling convergence, engineering verification and overall status.

- [ ] **Step 1: Document the stage ontology and compatibility boundary**

Record the six stage statuses, overall precedence, `engineering-summary/v1` compatibility, `result-summary/v1` compatibility and new `result-summary/v2` ownership.

- [ ] **Step 2: Run mandatory repository gates**

```text
npm run check
npm run typecheck
npm run test:architecture
npm run audit:architecture
npm test
```

Then require area gates for CLI, Web, Desktop and canonical equivalence on the exact PR head.

- [ ] **Step 3: Review exact diff against #119 vetoes**

Verify:
- singular requested erection cannot produce PASS;
- feasible demand-only erection cannot produce PASS;
- adaptive convergence is not reported as feasibility;
- guyed connection FAIL still dominates;
- bare/guyed numerical baselines are unchanged;
- no adapter contains a second status formula.

- [ ] **Step 4: Update PR/#119 evidence and merge only after exact-head GREEN**

```bash
git add docs/architecture/CONTRACTS.md tests/contracts.test.js
git commit -m "docs: define stage-aware project status contract"
```

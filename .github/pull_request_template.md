## What changes

<!-- Describe the user/engineering behaviour, or state that this is behaviour-preserving. -->

## Architecture / contract

- [ ] Change is in the owning layer described by `docs/ARCHITECTURE.md`.
- [ ] No engineering logic was copied into Web/CLI/Desktop adapters.
- [ ] No new deep import, environment leak, compatibility wrapper or unowned exception was introduced.
- [ ] External schema changes are versioned and have explicit contract/migration tests, or no external schema changed.

## Numerical / physical verification

- [ ] Canonical numerical baselines were not regenerated merely to make the PR pass.
- [ ] Relevant physical invariants / historical regressions are covered.
- [ ] Independent solver/equivalence gates remain green where applicable.
- [ ] Any intentional numerical change is explained with engineering justification and new reference evidence.

## Deletion ledger

<!-- List superseded code/imports/docs/scripts/tests removed in this PR. The expected final state is empty migration baggage, not retained wrappers. -->

- [ ] Every consumer has moved to the new path before the old path is deleted.
- [ ] No temporary migration artifact remains without a named owner and removal condition.

## Verification run

- [ ] `npm run check`
- [ ] `npm run typecheck`
- [ ] `npm run test:architecture`
- [ ] `npm run audit:architecture`
- [ ] `npm test`
- [ ] Focused physics/design/contracts/CLI/Desktop suites run as applicable.
- [ ] Performance budget checked when the calculation/build/export path changed.

## Dependencies / release impact

<!-- State new/removed dependencies, Desktop signing/packaging implications, or "none". -->

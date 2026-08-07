# ADR-006: Canonical project contract and immutable result lifecycle

Status: Accepted

Owners: issues #53 / #61

## Context

Before Architecture Foundation 2.0 the application accepted a flat parameter bag that mixed user choices, catalogue-derived material properties, derived geometry, transport-only values and historical/dead fields. The complete result was then enriched by several functions through in-place mutation. That made Web/CLI/Desktop equivalence difficult to prove and made persisted JSON ambiguous.

## Decision

There is exactly one public input model:

```text
ProjectInput
  geometry
  material
  environment
  equipment
  connection
  criteria
```

`ProjectInput` contains only values a caller may choose. Derived geometry, catalogue material properties, weather-derived values, effective connection geometry and solver/internal fixtures are not accepted at this boundary.

The only public resolution path is:

```text
ProjectInput -> resolveProjectInput() -> ResolvedProject
```

`ResolvedProject` is the canonical flat internal calculation contract during the implementation migration. Public adapters must not construct it themselves.

External JSON uses an explicit envelope:

```json
{
  "schema": "mast-calculator/project/v1",
  "project": { "...": "ProjectInput" }
}
```

Unknown schema versions, unknown top-level fields and unknown `ProjectInput` groups/fields are rejected. A future incompatible format requires a new schema id and an explicit migration function; silent best-effort coercion across versions is forbidden.

`calculateProject()` is the owner of the complete public `CalculationResult`. Result enrichment is copy-on-write and the completed public result is deeply frozen by default. Transport adapters may serialize or render the result but may not augment it with engineering data.

Application failures cross the public boundary as `MastApplicationError` with a stable category/code rather than transport-specific exceptions.

## Consequences

- Web, future CLI and Tauri consume the same grouped input and complete result.
- `extraHorizontalLoadN` / `extraVerticalLoadN` are not canonical user fields.
- derived values such as `ribCutLengthMm`, `moduleHeightMm`, `yieldStrengthMPa`, `windSpeedMs` and `jointEffectiveRadiusMm` belong only to `ResolvedProject` or later result data.
- persisted project JSON has a versioned compatibility contract.
- result mutation after the application boundary is an architecture violation.
- low-level flat helpers may remain temporarily only as internal test/migration support and are scheduled for deletion in issue #62; they are not a second public contract.

## Verification

CI must run strict TypeScript typechecking, runtime contract tests, architecture policy, canonical numerical equivalence, triple-FEM checks and the complete regression suite before this boundary may be merged.

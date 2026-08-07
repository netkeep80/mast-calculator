# ADR-004: Progressive TypeScript migration

Status: Accepted  
Issue: #50  
Follow-up: #53

## Context

The current JavaScript engineering code is numerically mature enough that a simultaneous architectural rewrite and full TypeScript rewrite would make regression attribution difficult. At the same time, flat unversioned objects allow dead inputs, derived fields and partial `CalculationResult` shapes to leak across layers.

## Decision

TypeScript is introduced progressively at architectural boundaries rather than by rewriting mathematics in bulk.

Priority order:

1. versioned external/transport contracts;
2. `ProjectInput` and runtime validation;
3. `ResolvedProject` with derived values removed from public input;
4. complete immutable `CalculationResult`;
5. public application APIs;
6. engineering internals module by module.

Strictness increases monotonically. A migration PR must preserve numerical behavior and use the #51 equivalence suite to prove it.

Runtime validation remains mandatory for untrusted JSON even after compile-time TypeScript types exist.

## Consequences

- old JavaScript and new TypeScript may coexist temporarily by module boundary, but not as parallel implementations of the same responsibility;
- `allowJs`/incremental compiler settings are migration tools, not permanent exemptions;
- derived/dead fields are removed from external contracts instead of merely receiving TypeScript types;
- formula changes are explicitly out of scope for mechanical type-migration PRs.

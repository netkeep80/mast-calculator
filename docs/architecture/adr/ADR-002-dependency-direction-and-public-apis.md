# ADR-002: Dependency direction and public APIs

Status: Accepted  
Issue: #50  
Follow-up: #52, #53, #54

## Context

Today Web code imports many individual files under `apps/web/engine/**`. This makes internal modules accidental public APIs and lets presentation code bypass orchestration.

## Decision

Dependency direction is one-way:

```text
apps/adapters
  -> application
    -> engineering/design/reporting
      -> structural-analysis/domain
        -> numerics
```

Each layer exposes explicit public entry points. Consumers must not deep-import implementation files across a layer boundary.

The application layer owns complete use cases and transport-neutral contracts. Adapters translate environment I/O only.

## Enforcement

- architecture audit reports production imports, reverse importers and cycles;
- engineering/core may not import app adapters;
- browser/Node environment dependencies are forbidden in engineering/core unless an exact temporary baseline exception names the debt and owner issue;
- later extraction PRs replace deep imports with public entry points and delete old paths once every consumer is migrated.

## Consequences

- moving an internal file no longer requires changes throughout Web/CLI/Desktop;
- test imports must distinguish public contract tests from implementation-detail tests;
- public entry points become versioned/stable surfaces while internals remain refactorable.

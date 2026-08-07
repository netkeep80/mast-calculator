# ADR-003: No parallel legacy implementation

Status: Accepted  
Issue: #50  
Follow-up: #52–#57

## Context

Architecture migrations often leave old modules, aliases and wrappers "temporarily" in the working tree. That creates two valid-looking paths, increases test duplication and eventually makes it unclear which behavior is canonical.

Git already preserves the old implementation and its history.

## Decision

Every foundation migration PR follows this sequence:

```text
strengthen tests
-> build the new boundary
-> migrate every consumer
-> prove numerical/contract equivalence
-> delete old implementation
-> delete old imports/docs/tests
-> merge
```

Once every consumer has moved, the old implementation is deleted in the same PR. Compatibility aliases/wrappers require a named, short-lived migration need and an owner issue; they are not a default strategy.

## Consequences

- there is one canonical implementation of FEM, result assembly, project serialization and each engineering rule;
- deletion ledger entries shrink as migration progresses;
- tests that exist only to preserve removed wiring are deleted after replacement coverage is established;
- historical recovery uses Git, not dead source files.

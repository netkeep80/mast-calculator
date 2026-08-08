# Repository instructions for AI agents

Read `CONTRIBUTING.md` and `docs/ARCHITECTURE.md` before modifying production code.

Hard rules:

- preserve canonical numerical results during refactoring; numerical drift blocks merge;
- never update canonical baselines merely to accept changed numbers;
- keep one TypeScript engineering implementation shared by Web, CLI and Desktop;
- do not import browser, Node or Tauri environment APIs into `packages/**`;
- use public package entrypoints across package/app boundaries;
- validate and resolve `ProjectInput` at the application boundary; keep `CalculationResult` complete and immutable;
- version incompatible external JSON contracts and test migrations explicitly;
- after migrating all consumers, delete the superseded implementation/imports/docs/scripts/tests in the same PR;
- do not retain compatibility wrappers, aliases or temporary allowlists without a current owner issue/ADR and a removal condition;
- do not add dependencies or Rust solver code simply because an adapter makes them convenient;
- run the focused suite for the changed responsibility and the full CI-equivalent checks before merge.

Preferred migration sequence:

```text
tests/invariants → new boundary → all consumers → equivalence proof → deletion → merge
```

Git history is the archive for old internal architecture.

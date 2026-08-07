# ADR-005: Tauri is a desktop shell, not a second engineering core

Status: Accepted  
Issue: #50  
Follow-up: #56

## Context

The desktop application must run on Windows, Linux and macOS, support offline Open/Save workflows and expose the same calculation/design/reporting capabilities as Web and CLI.

Tauri itself is implemented around Rust/native APIs, which can create pressure to duplicate or rewrite engineering code in Rust.

## Decision

Tauri is an environment adapter around the same TypeScript/JavaScript application and headless engineering core used by Web and CLI.

Rust/native code is limited to shell responsibilities where Tauri requires it, such as:

- application lifecycle;
- native Open/Save dialogs;
- filesystem/OS integration;
- packaging/updating/security policy.

The FEM solver, engineering rules, result assembly, optimization, project package, reporting projections and design calculations remain single-source unless a future separately reviewed ADR demonstrates a concrete technical necessity to replace an implementation.

## Consequences

- Desktop numerical results must be equivalent to direct core and CLI for the same `project-package/v1` input;
- no second solver test matrix is accepted as a substitute for one shared solver;
- desktop-specific code depends inward through application ports and never becomes a dependency of engineering/core;
- Rust is not selected merely because Tauri uses Rust.

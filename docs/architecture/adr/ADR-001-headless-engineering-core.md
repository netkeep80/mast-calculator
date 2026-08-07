# ADR-001: Headless engineering core

Status: Accepted  
Issue: #50  
Follow-up: #52

## Context

The current engineering implementation already lives mostly under `apps/web/engine/**`, but the directory is not a true architectural boundary. Web modules deep-import engineering internals, and `design-package.js` contains browser persistence.

CLI and Desktop require the same calculations without DOM, Worker, localStorage, filesystem or Tauri assumptions.

## Decision

Create a headless engineering core with no direct dependency on:

- `window`, `document`, `self`, `Worker`;
- `localStorage`, `fetch`, `Blob`, browser download APIs;
- filesystem/process/`node:*` infrastructure APIs;
- Canvas/WebGL/Tauri APIs.

Environment-specific behavior is provided through application ports and app adapters.

The existing FEM/numerical implementation is migrated, not duplicated or rewritten.

## Consequences

- Web, CLI and Desktop call the same engineering implementation.
- Pure engineering tests run in Node without browser emulation.
- Browser persistence currently mixed into `design-package.js` must move to an adapter.
- #52 may move files and establish package boundaries only after #51 protects numerical behavior.

## Non-goals

This ADR does not change formulas, add P-Delta, introduce a CLI, or rewrite the solver in Rust.

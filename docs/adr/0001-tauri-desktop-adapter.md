# ADR 0001: Tauri as the Desktop environment adapter

- Status: Accepted
- Date: 2026-08-08
- Scope: Architecture Foundation 2.0 / issue #56

## Context

Mast Calculator needs downloadable Windows, Linux and macOS applications while preserving one engineering implementation. The repository already has a browser presentation layer, a headless TypeScript application API, engineering/design/reporting packages, a Worker-based calculation path and a portable project package.

A Desktop implementation that copies the Web application, forks the solver, or moves FEM into Rust would create two numerical products whose behaviour can drift. That violates the Architecture Foundation numerical-equivalence veto and makes every later physics improvement more expensive to verify.

Desktop also needs native Open/Save dialogs and filesystem persistence without granting a WebView broad filesystem or shell access.

## Decision

Use Tauri as a thin environment shell around the canonical Web presentation and TypeScript core.

The dependency direction is:

```text
Tauri shell -> generated canonical Web presentation -> application API -> engineering packages
```

Never:

```text
engineering/application -> Tauri
```

The Desktop WebView is generated from the normal Web build. Desktop-specific code is restricted to environment adapters and shell configuration. The Rust process exposes only narrow commands required to complete a user-selected file operation.

Calculation, optimization, progress and cancellation remain on the shared Worker/controller path unless a measured performance problem later justifies a different execution adapter. Tauri being implemented in Rust is not itself a reason to port numerical code to Rust.

## File I/O decision

Shared presentation code depends on a `fileAdapter`. The browser implementation owns browser-only file input/Blob behaviour. The Desktop implementation invokes native-dialog commands. The Rust command selects the path itself and then reads/writes that selected path.

No generic arbitrary-path filesystem command, shell command, HTTP bridge or updater permission is exposed to the WebView.

## Packaging decision

Maintain one square RGBA source icon and derive platform-specific icon formats with the pinned Tauri icon generator. Generated ICO/ICNS/PNG variants are build products rather than independently maintained source assets.

Pull-request CI must compile the shell and create real unsigned bundles on Windows, Linux and macOS. Published GitHub Releases attach those unsigned artifacts. Signing, notarization and auto-update are deferred until a trust/signing model exists.

## Printing decision

Keep report generation in the shared reporting package and treat HTML as the canonical printable artifact. Desktop saves HTML through the native file adapter; printing/PDF can be performed by the system browser. No WebView-specific PDF generator is added to the core.

## Consequences

Positive consequences:

- Web, CLI and Desktop execute the same application/core code;
- no second FEM/optimizer/reporting implementation exists;
- Desktop receives native file dialogs and packaging with a small Rust surface;
- numerical and artifact equivalence can be tested directly;
- offline behaviour follows naturally from packaged local Web assets;
- later physics work has one canonical implementation to change.

Costs and constraints:

- Tauri platform prerequisites remain part of native builds;
- platform WebViews can differ in rendering details, so printable output is saved as HTML rather than promising identical native print/PDF behaviour;
- release signing is a separate operational concern and unsigned builds can trigger OS warnings;
- any future Tauri capability expands the security surface and therefore requires explicit review and tests.

## Rejected alternatives

### Independent Desktop UI/application copy

Rejected because forms/controllers and eventually behaviour would diverge from Web.

### Electron

Not selected because the current product does not need a bundled Chromium/Node runtime to host engineering logic. This can be revisited only if a concrete Tauri/WebView limitation becomes a product blocker.

### Port solver/FEM to Rust

Rejected for this architecture phase. It would create a second numerical implementation without a demonstrated need and would make equivalence a migration project rather than an adapter property.

### Broad Tauri filesystem/shell plugins

Rejected under least privilege. Current Desktop workflows require only user-selected Open/Save operations.

## Verification

This decision remains valid only while CI proves:

- compiler-emitted Desktop packages are the canonical application/design/reporting packages;
- Desktop uses the canonical calculation Worker/controller;
- canonical calculation summaries match direct application API results;
- exported design/report/OBJ/procurement artifacts remain equivalent;
- no Tauri import leaks into the core packages;
- the three target operating systems compile and bundle successfully.

# Desktop application

Mast Calculator Desktop is a Tauri environment adapter over the same presentation modules and the same TypeScript engineering/application/design/reporting packages used by Web and CLI. It is not a second implementation of the solver.

## Architecture

```text
packages/domain .. reporting        canonical TypeScript core
              ↓
packages/application                canonical use cases / project package
              ↓
apps/web                             shared presentation + Web Worker/controller
       ↙                    ↘
browser file adapter         desktop file adapter
                                   ↓
apps/desktop/src-tauri              thin Tauri shell
```

`scripts/build-desktop-web.mjs` first builds the canonical Web tree and then overlays only Desktop environment modules. The Desktop build therefore contains the same calculation Worker/controller and compiler-emitted packages as the Web application. Regression tests compare canonical summaries and exported artifacts between the direct application API and the packaged Desktop tree.

No FEM, engineering formula, optimizer, report generator, design generator or procurement implementation is duplicated in `apps/desktop`.

## File operations

Presentation code uses one `fileAdapter` abstraction. In a browser it maps to file input/Blob downloads. In Desktop it maps to two Tauri commands:

- `open_text_file` — native Open dialog followed by reading the path selected by the user;
- `save_text_file` — native Save dialog followed by writing only the path selected by the user.

That single boundary covers project-package JSON, design-package JSON, OBJ, calculation/report HTML, ESKD HTML, procurement HTML/CSV and other current text artifacts. The Rust shell does not expose unrestricted filesystem, shell, HTTP or updater APIs to the WebView.

## Calculation, optimization and cancellation

Calculation and optimization continue to run through the canonical Web Worker/controller. Desktop does not move the solver to Rust. Progress and cancellation semantics therefore stay on the same code path as Web; the Desktop equivalence tests additionally assert that the packaged Worker/controller are the canonical files rather than copies.

## Version and build identity

The generated Desktop WebView contains `build-info.json`. The shared runtime UI displays:

```text
Desktop v<app-version> · core <core-version> · <git-sha> · <git-ref>
```

when the information is available from the build environment.

## Offline guarantee

The packaged application has no runtime CDN dependency. `build-desktop-web.mjs` rejects remote runtime scripts/imports, required package code is copied into the generated tree, and the Tauri CSP restricts the WebView to local content plus Tauri IPC. External normative/source links are not part of calculation execution.

Network access is not required to open a saved project, calculate, optimize, inspect results, use the design workspace, or export generated artifacts.

## Security boundary

The main Tauri window receives one narrow capability containing only the custom project-file permission. The shell intentionally has no `fs`, `shell`, `http` or `updater` frontend plugin. File paths originate from native dialogs rather than arbitrary WebView strings.

Any future capability must be justified by a concrete Desktop use case and covered by the permission regression tests.

## Printing and PDF

The canonical reporting layer produces HTML. Desktop saves that HTML through the native Save dialog; the saved document can then be opened in the system browser and printed using the operating system/browser print facilities. This keeps printing outside the engineering core and avoids pretending that an unsigned WebView-specific direct-PDF path is portable.

Direct PDF export is therefore **not** part of the Desktop contract at this stage. Adding it later requires one reliable cross-platform adapter and must not fork report generation.

## Icons

`apps/desktop/src-tauri/icons/icon.png` is the only maintained source icon. `npm run prepare:desktop:icons` runs the pinned Tauri icon generator and creates the platform iconset under `generated-icons/`; generated icon binaries are not committed. This prevents Windows ICO and macOS/Linux icon assets from drifting independently.

## Related documents

- `docs/BUILD_AND_RELEASE.md` — prerequisites, CI, unsigned bundles and release publication.
- `docs/adr/0001-tauri-desktop-adapter.md` — architecture decision record.

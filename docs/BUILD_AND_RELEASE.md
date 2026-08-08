# Desktop build and release

The Desktop shell is intentionally reproducible from repository sources without a second engineering runtime. Builds are currently **unsigned**: there is no Windows code-signing certificate, macOS Developer ID/notarization setup, or signed auto-update channel in the repository.

## Toolchain

Required on every platform:

- Node.js 24;
- Rust stable toolchain with Cargo;
- the platform prerequisites required by Tauri/WebView;
- network access while resolving build dependencies. Runtime operation of the resulting application is offline-first.

The repository pins the reviewed Tauri generations used by the shell and CI. Do not silently float these versions during Architecture Foundation work.

### Linux CI prerequisites

CI uses Ubuntu 22.04 and installs:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Windows runners provide the Microsoft build tooling required by the Rust/Tauri build. macOS runners provide the Apple command-line build tools.

## Local preparation

From the repository root:

```bash
npm run prepare:desktop:icons
npm run build:desktop:web
npm run test:desktop
```

The first command derives the complete platform iconset from the canonical square RGBA PNG. The second command builds the canonical Web application and overlays only the Desktop environment adapter into `_desktop`.

To compile the Rust shell without bundling:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

To run Tauri locally after the preparation steps:

```bash
cd apps/desktop
npx --yes @tauri-apps/cli@2.11.4 dev
```

## Local bundles

After preparing icons and the Desktop WebView:

```bash
cd apps/desktop
npx --yes @tauri-apps/cli@2.11.4 build --bundles appimage  # Linux
npx --yes @tauri-apps/cli@2.11.4 build --bundles nsis      # Windows
npx --yes @tauri-apps/cli@2.11.4 build --bundles app       # macOS
```

Build the native bundle on its target operating system. The project does not claim a cross-compiled Desktop release matrix.

## Pull-request CI

`.github/workflows/desktop.yml` provides two gates:

1. the packaged-core oracle builds `_desktop`, runs Desktop adapter tests and verifies numerical/artifact equivalence;
2. the Tauri shell compiles on Ubuntu, macOS and Windows.

`.github/workflows/desktop-bundle.yml` builds actual unsigned artifacts on all three platforms:

- Linux AppImage;
- Windows NSIS installer;
- macOS `.app` bundle.

These artifacts are retained as GitHub Actions artifacts for inspection. A shell compile alone is not accepted as proof that packaging works.

The existing Architecture Foundation, CLI, canonical regression and physics/triple-solver gates remain independent vetoes. Desktop must not regenerate canonical numerical baselines to make a platform build pass.

## Release publication

`.github/workflows/desktop-release.yml` runs when a GitHub Release is published and may also be invoked manually as a build smoke. It builds the same three unsigned bundles. For a published Release, the workflow stages portable files and attaches them to that Release:

- `mast-calculator-linux.AppImage`;
- `mast-calculator-windows-setup.exe`;
- `mast-calculator-macos.app.zip`.

The manual workflow-dispatch path builds and uploads workflow artifacts but intentionally does not invent or mutate a GitHub Release.

## Signing status

All Desktop artifacts are currently unsigned. This has practical consequences:

- Windows SmartScreen may warn about an unknown publisher;
- macOS Gatekeeper may require explicit user approval for the unsigned/unnotarized app;
- no auto-updater is enabled.

Signing/notarization should be introduced only after keys/certificates, secret handling, provenance and updater trust policy are designed. It is an operational security follow-up, not a reason to fork or postpone the Desktop architecture.

## Release checklist

Before publishing a release, require all current required checks to be green, including canonical numerical equivalence, Desktop packaged-core equivalence, three-platform shell compilation and three-platform bundle creation. Verify that the branch/tag points to the intended version and that `build-info.json` records the expected commit identity.

Do not publish a Desktop artifact from a working tree containing generated compatibility code or a second solver implementation.

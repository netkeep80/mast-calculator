# Mast Calculator

Статическое браузерное приложение для расчёта модульной мачты из сварных арматурных октаэдров. Backend не требуется: расчёт выполняется в браузере, публикация — через GitHub Pages.

Опубликованная версия: **https://netkeep80.github.io/mast-calculator/**

Документация:

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — требования и допущения;
- [`docs/CALCULATION_ARCHITECTURE.md`](docs/CALCULATION_ARCHITECTURE.md) — FEM, solver и data flow;
- [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md) — межмодульный болт и сварные концы;
- [`docs/VERIFICATION_FOR_NON_SPECIALISTS.md`](docs/VERIFICATION_FOR_NON_SPECIALISTS.md) — пошаговая верификация;
- [`docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md`](docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md) — lateral/weather/sanity-check;
- [`docs/STATIC_PAYLOAD_CAPACITY.md`](docs/STATIC_PAYLOAD_CAPACITY.md) — максимальная масса на вершине;
- [`docs/PERFORMANCE_AND_PROGRESS.md`](docs/PERFORMANCE_AND_PROGRESS.md) — Worker/performance;
- [`docs/CI_CD_REVIEW.md`](docs/CI_CD_REVIEW.md) — CI/CD.

## Прототип 1.0

Версия 1.0 добавляет physical connection post-processing поверх 3D frame FEM:

- выбранный межмодульный bolt — tension/shear/combined action;
- characteristic rupture reference `Rbun*Abn` отдельно от design capacity;
- minimum standard bolt diameter для классов 5.6 / 5.8 / 8.8 / 10.9 / 12.9;
- minimum total fillet-weld length на каждом physical member end;
- electrode/wire recommendation;
- bolt как возможный governing mode lateral/static capacity;
- `CalculationSnapshot v7` с полным `connections` object.

## Геометрия

Из закупочной длины и числа частей:

```text
a = Lstock/nparts
R = a/sqrt(3)
h = a*sqrt(2/3)
H = Nmodules*h
```

Один regular octahedron: `3 horizontal + 6 diagonal = 9 members`.

## 3D frame FEM

Node DOF:

```text
[ux,uy,uz,rx,ry,rz]
```

Circular member:

```text
A = pi*d²/4
I = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
```

Euler–Bernoulli element returns coincident end actions:

```text
N
Vy,Vz
T
My,Mz
```

Global solver uses symmetric band Cholesky; geometric stiffness and matrix-free generalized Lanczos solve:

```text
(K + lambda*KG)*phi = 0
```

For one geometry `K` is assembled/factorized once and reused by operational, lateral and static-payload cases.

## Нагрузки

Operational calculation supports:

- self weight;
- cylindrical ice;
- wind on spatial round members;
- equipment mass/wind area;
- extra horizontal/vertical load;
- wind-direction envelope;
- Beaufort 0–12 or custom pressure.

Preset pressure:

```text
q = rho_air*v²/2
rho_air = 1.225 kg/m³
```

Beaufort presets are comparative scenarios, not a replacement for СП 20 load design.

## Межмодульный болт

At each interior FEM node six members meet. Physical stacking interpretation:

```text
4 members remain with lower module
2 upward diagonals form next module foot
1 vertical bolt connects the two parts
```

For `N>1`:

```text
Njoints = 3*(N-1)
```

The two upward members from the **same load case** are transformed to global coordinates and summed:

```text
Fjoint = F1 + F2
Mjoint = M1 + M2
```

Bolt axis is vertical. Solver end-force sign is interpreted physically:

```text
Faxis > 0 -> joint contact is compressed
Faxis < 0 -> joint tends to open
```

Therefore compression is not turned into fictitious bolt tension:

```text
Nt,direct = max(0,-Faxis)
Ncontact = max(0,Faxis)
```

Rigid frame moment is transferred through explicit effective contact radius `reff`:

```text
Nt = max(0,-Faxis) + |Mb|/reff
Ns = |Fperp| + |T|/reff
```

Compression is deliberately **not credited** against `|Mb|/reff` until an exact contact-pressure model exists. `reff` is visible/editable and must match the real washer/nut/stop geometry.

СП 16 design capacities:

```text
Nbs = Rbs*Ab*ns*gamma_b*gamma_c
Nbt = Rbt*Abn*gamma_c
Ubolt = sqrt((Ns/Nbs)^2 + (Nt/Nbt)^2)
PASS: Ubolt <= 1
```

For current single-bolt joint `gamma_b=1`.

Characteristic rupture reference:

```text
Nu,characteristic = Rbun*Abn
```

is shown separately and is **not** an allowable working load.

Auto-selection checks `M16/M20/M24/M30/M36/M42/M48` for each supported property class. Class 5.8 is not accepted for tension because the used СП 16 table does not provide `Rbt` for it.

Full details: [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md).

## Сварка

Each physical member end keeps one coincident vector from one load case:

```text
N
V = hypot(Vy,Vz)
T
M = hypot(My,Mz)
```

Because exact coordinates of the actual beads around the nut are not yet inputs, the current model explicitly uses a conservative circular-group surrogate:

```text
Qaxial = |N| + 2*|M|/rw
Qshear = |V| + |T|/rw
Qw = sqrt(Qaxial² + Qshear²)
```

Required effective length:

```text
Rwz = 0.45*Run
lw,f = Qw/(beta_f*kf*Rwf*gamma_c)
lw,z = Qw/(beta_z*kf*Rwz*gamma_c)
lw = max(lw,f,lw,z,4*kf,40 mm)
```

Physical total length for `nsegments` continuous welds:

```text
Lphysical = lw + 10 mm*nsegments
```

Catalog contains Э42А, Э46А, Э50А/УОНИ-13/55, Св-08Г2С baseline Э50, Э60, Э70, Э85 and selects the first consumable with `Rwun >= Run` of the weaker parent metal.

## Lateral capacity

Special unit case:

```text
F0 = 1 N horizontal at top
```

with gravity/weather/equipment disabled.

```text
Fmember = 1/Umember(1 N)
Fglobal = lambda_cr(1 N)*1 N
Fbolt   = 1/Ubolt(1 N)
Flim = min(Fmember,Fglobal,Fbolt)
```

A weak intermodule bolt can become `governingMode=bolt-connection`.

Solid-rod sanity-check intentionally compares **memberLimitForceN**, not overall `Flim`, because its job is to validate frame/member scale rather than a concrete M24 in an artificial `d_rib=a/2` model.

## Максимальная статическая масса на вершине

Gravity-only binary search keeps self weight. Every trial mass checks:

```text
U_member(m) <= 1
U_bolt(m) <= 1
lambda_cr(m) >= 1
```

Pure vertical compression does not create direct bolt tension merely because its magnitude grows. Bolt demand appears only from actual separating/shear/moment components of the calculated state.

UI also reports remaining mass and equivalent water volume at `rho_water=1000 kg/m³`.

## Verification passport

`calculateCompleteMast()` builds six evidence levels:

1. simple formulas;
2. force/moment equilibrium and residuals;
3. known-answer `FL/EA`, `PL³/3EI`, `PL²/2EI` tasks using production solver;
4. dense/reference algorithm cross-checks;
5. external FEM and engineering review — `NOT VERIFIED`;
6. physical validation — `NOT VERIFIED`.

Green levels 1–4 verify implementation of the stated model; they do not prove safety of the fabricated structure.

## Paper report / snapshot

The printable HTML includes:

- inputs, Git SHA, geometry, loads;
- frame actions/stresses/buckling;
- lateral/static capacity;
- physical joint split and `reff`;
- `Nt/Ns/Nbt/Nbs/Ubolt/Rbun*Abn`;
- minimum bolt by class;
- critical weld ends and required lengths;
- consumable recommendation;
- verification passport and explicit limits.

Internal reproducibility format:

```text
mast-calculator/calculation-snapshot/v7
```

No user JSON button is exposed.

## Что ещё не считается

Version 1.0 calculates the bolt itself and minimum weld length, but does not invent missing geometry for:

- thread stripping / actual engagement length;
- bearing of nut/washer/member material;
- prying and washer/contact bending;
- preload/friction/slip;
- exact weld-group `W/Ix/Iy`;
- finite joint stiffness;
- fatigue;
- foundation;
- P-Delta/initial imperfections/plasticity.

These require actual manufactured joint dimensions and external validation.

## CI/CD

PR checks:

```text
Syntax, policy and maintainability
Secrets scan
Tests: Ubuntu/macOS/Windows
Static site smoke
```

The 40-module regression checks one `K` factorization, 720 free DOF, bounded bandwidth, `117` internal bolt joints, one weld-envelope item per physical member end, finite bolt limits and green internal verification.

## Локальный запуск

```bash
python3 -m http.server 8080 --directory site
npm test
npm run check
node scripts/check-file-line-limits.mjs
```

Runtime npm dependencies: none.

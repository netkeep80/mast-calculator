# Архитектура расчётного ядра

Статус: актуальная архитектура после issue #33.

## 1. Поток данных

```text
user input / scenario
        ↓
resolve material + weather + exact octahedron geometry
        ↓
generate physical 9-member modules
        ↓
compile global frame system + module stack
        ↓
operational load cases
        ↓
┌─────────────────────────┐
│ global banded FEM       │
│ exact module Schur      │ <- runtime cross-check
└─────────────────────────┘
        ↓
member N/V/T/M + modular interface actions
        ↓
connection configurator
  geometry + nut net area + preload + bolt tension/shear + weld
        ↓
fix selected physical joint
        ↓
┌────────────────┬──────────────────┬────────────────────┐
│ lateral limit  │ static top mass  │ maximum height     │
└────────────────┴──────────────────┴────────────────────┘
        ↓
verification / report / snapshot / UI / reference audit
```

Independent dense FEM находится в test/verification path и не участвует в обычном browser calculation.

## 2. Геометрия

Физический модуль — правильный октаэдр ножками вниз:

```text
edge a = Lstock/nparts
R = a/sqrt(3)
h = a*sqrt(2/3)
3 top-ring + 6 leg = 9 members/module
```

Уровни чередуются на 60°. Геометрия не имеет специального `closeTopRing`: верхний треугольник принадлежит последнему физическому модулю.

## 3. Frame element

Node DOF:

```text
ux,uy,uz,rx,ry,rz
```

Member — 12-DOF 3D Euler–Bernoulli frame. Для круглого сечения вычисляются `EA, EIy, EIz, GJ`. Member loads self-weight/ice/wind задаются distributed и переходят в consistent local nodal vector.

После solve восстанавливаются local end forces:

```text
[N,Vy,Vz,T,My,Mz]A
[N,Vy,Vz,T,My,Mz]B
```

## 4. Production global solver

`compileFrameSystem()` строит symmetric band stiffness и factorizes один раз на геометрию. Несколько load cases используют одну факторизацию.

Статическая задача:

```text
K*u = F
```

Контролируются residual, free-DOF equilibrium, force/moment equilibrium, pivots/conditioning diagnostics.

## 5. Module Schur solver

Один модуль имеет 36 interface DOF:

```text
bottom 18
top 18
```

Top-down:

```text
A = Ktt+Supper
S = Kbb-Kbt*A^-1*Ktb
p = fb-Kbt*A^-1*(ft+pupper)
```

Bottom-up:

```text
ut = A^-1*(ft+pupper-Ktb*ub)
```

Результат — математически тот же linear system, но другой assembly/solution path. Runtime сравнивает полный displacement/rotation vector с global FEM и баланс общих interfaces.

### Верхняя грань issue #32

В modular result специально различаются:

```text
topStructuralFromAbove
topDirectApplied
topAppliedFromAbove = structural + direct
```

`Kmodule*u-fmodule` даёт structural action соседней конструкции; direct nodal load уже находится в `fmodule`, поэтому его нельзя терять в пользовательском результате. Interface closure соседних модулей использует structural action, чтобы direct load не удваивался.

## 6. Independent dense reference FEM

Отдельная implementation самостоятельно собирает element matrices/load vectors, full dense `K`, решает Gaussian elimination и восстанавливает reactions/end forces. Она не импортирует production band solver или module stack.

CI сравнивает global ↔ Schur ↔ dense по DOF, reactions и 12 end-force components. Для выбранных небольших cases production matrix-free buckling сравнивается с dense generalized eigen reference.

## 7. Member design checks

Elastic von Mises + local Euler:

```text
Ustress = sigma_eq/(Ry/gamma_M)
UEuler = Ncompression/NE
Umember = max(Ustress,UEuler)
```

Это current engineering model, не полный нормативный SP16 member curve.

## 8. Global eigen-buckling

```text
(K + lambda*KG)*phi = 0
```

`KG` строится из текущего compression state. Production solver — matrix-free generalized Lanczos с eigen residual. Global buckling остаётся полной связанной задачей; Schur static decomposition её не заменяет.

## 9. Connection-layer

Global frame joints остаются ideal-rigid. Реальная двухгаечная сборка проверяется после FEM.

Topology:

```text
upper module: 2 ribs -> clearance nut My
vertical bolt Mx passes through My
lower module: 4 ribs -> coupling nut Mx
bolt screws into coupling nut
```

`joint-configurator.js` строит geometry каждого candidate. `joint-demand.js` переводит coincident upper-rib resultants в bolt-axis components. `connection-check.js` объединяет bolt/nut/weld checks.

## 10. Nut geometry and net section — issue #33

Hardware geometry проверяет свободный проход, engagement и bolt length. Новый independent filter:

```text
Ahex = sqrt(3)/2*s²
Anet = Ahex-pi*D1²/4
Arib = pi*dbar²/4
Anet/Arib >= ksection >= 2
```

`joint-section-check.js` проверяет обе гайки. Недостаточная площадь делает candidate invalid. Для height/lateral/static это должно вести к невозможности использовать такой fixed joint, а не просто к информационному warning.

## 11. Bolt demand and oblique shear

Для resultants двух upper ribs:

```text
Faxis = F·eb
Fperp = F-eb(F·eb)
Nt,direct=max(0,-Faxis)
Ns,direct=|Fperp|
```

Moment surrogate:

```text
reff=s/2
Nt,external=Nt,direct+|Mb|/reff
Ns=Ns,direct+|T|/reff
```

`directShearN`/`shearFromInclinedForceN` публикуется отдельно, поэтому срез от наклонной геометрии нельзя потерять внутри aggregate demand.

## 12. Torque preload — issue #33

`bolt-preload.js` реализует:

```text
F0,nom=T/(K*d)
F0,max=(1+Gamma)*F0,nom
F0,min=(1-Gamma)*F0,nom
```

Project defaults:

```text
T=200 N*m
K=0.20
Gamma=0.25
```

Strength tension:

```text
Nt,strength=F0,max+Nt,external
```

Bolt check:

```text
Nbs=Rbs*Ab*ns*gamma_c
Nbt=Rbt*Abn*gamma_c
Ubolt=hypot(Ns/Nbs,Nt,strength/Nbt)
```

Model is deliberately conservative: external separating load is fully additive to max preload, and friction-grip shear relief is not credited.

Direct low-level `bolt-check` APIs default `T=0` for backward-compatible analytical tests. User-facing connection parameters are resolved by `joint-strength-parameters.js` to explicit project defaults.

## 13. Weld-layer and area reserve — issue #33

Coincident member-end `N/V/T/M` enters existing circular weld-group surrogate. Two force-resistance boundaries and code/project minimum length remain.

Additionally:

```text
teff=beta_f*kf
Aeff=teff*lweff
Aeff>=kweld*Arib
2<=kweld<=3
default=2.5
```

`calculateMinimumWeldLength()` returns the maximum of force-based, minimum-length and area-based required length. The 2–3× coefficient is a project criterion; docs/reference/report must not label it as an SP/AISC requirement.

## 14. Auto-configurator and fixed physical joint

For each bolt candidate:

```text
hardware geometry
→ nut net-section
→ recompute reff
→ decompose demand
→ torque preload
→ bolt interaction
```

First passing candidate is selected according to class/diameter policy. Weld configuration is selected separately and checked against actual envelope.

After operational cases choose a physical joint, resolved parameters are frozen and reused for lateral/static/height trial calculations. Trial cases may not auto-upsize the connection.

## 15. Lateral capacity

Pure normalized horizontal tip test excludes permanent/weather/equipment loads. From 1 N cases it derives independent member/global-buckling/bolt envelopes. First limit is their minimum. Connection utilization includes fixed-joint preload and nut-geometry validity.

## 16. Static top payload

Gravity-only trial search retains mast self-weight and fixed connection but excludes wind/ice. Binary search checks member, bolt/connection and global buckling. Payload mass and water equivalent are user-facing outputs.

## 17. Maximum height

Integer module count search:

```text
exponential bracket
→ binary search
→ local neighbour scan
```

Design and ultimate-resistance limits differ by displacement and required `lambda_cr`. Fixed connection validity is part of candidate pass/fail.

## 18. 3D connection visualization — issue #33

`joint-visual-geometry.js` is a deterministic geometry layer independent of canvas drawing. It derives six local rib directions from a regular octahedron:

```text
coupling nut: 2 top-ring + 2 legs-down
clearance nut: 2 legs-up
```

Diagonal leg angle:

```text
acos(sqrt(2/3)) = 35.264... deg to bolt axis
```

For every rib the module stores nearest hex face, face normal, contact point, angle to bolt axis, angle to face plane and weld display segment.

`joint-viewer.js` renders filled depth-sorted prisms with procedural metallic gradient/hatching, ribbed bars, yellow contact markers and red weld zones. Thread profile is intentionally omitted.

## 19. Reference data / report / snapshot

`reference-data.js` remains a view over production catalogs, not a duplicated constants file. Schema `reference-data/v2` adds project connection criteria and source/status notes.

Paper report appends:

```text
Anut/Arib
T,K,Gamma,F0,max,Upreload
external vs strength tension
oblique direct shear
Aeff,weld/Arib
```

Internal snapshot serializes the full connection object so new fields remain reproducible without changing the user-facing JSON policy.

## 20. Fabrication mass

`assembly-mass.js` estimates ribs, hardware and weld deposit. Fabrication mass is not fed back into current FEM self-weight because required weld length is itself an output of FEM; introducing it requires an explicit iterative/fixed-fabrication model.

## 21. Web Worker / UI

Heavy calculation stays off the main thread. `app-bootstrap.js` enriches the existing form with issue #33 controls and passes them through the worker. No second browser FEM solver is introduced.

## 22. CI layers

Required gates include:

```text
Syntax, policy and maintainability
Secrets scan
Triple FEM equivalence
Joint configurator
Joint strength and visualization
Support reaction statics
Usage scenarios and reference catalogs
Full tests Ubuntu/macOS/Windows
Static site smoke
```

`test:joint-strength` covers nut net sections, weld area ratio, torque-preload, oblique shear and 3D geometry semantics. Full `node --test` retains all previous regression cases.

## 23. Model boundaries

The architecture still does not implement geometric nonlinearity/P-Delta, imperfections, plastic hinges, finite connection/contact stiffness, thread stripping by actual nut material/tolerance, bearing/prying, preload load-sharing by bolt/clamped-part stiffness, friction-grip/slip, exact weld bead geometry/defects/residual stress/fatigue, self-loosening, compliant foundation or full normative load combinations.

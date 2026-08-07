# Архитектура расчётного ядра

Статус: архитектура прототипа 1.0.

Документ фиксирует границы между практическим вводом, геометрией, global 3D frame FEM, solver, физическим post-processing соединений, специальными предельными cases, verification, Worker и отчётностью.

## 1. Общий поток

```text
Practical input
  stock/cutting/rebar/material/weather/loads
  bolt class/diameter/joint radius
  weld material/leg/segments
        |
        v
Parameter resolution
  a = Lstock/nparts
  h = a*sqrt(2/3)
  reinforcement catalogue
  connection catalogues
  weather preset -> v -> q
        |
        v
Regular-octahedron geometry
        |
        v
compileFrameSystem()
  member geometry + transforms
  free DOF map
  symmetric band K
  Cholesky(K) once
        |
        +---- operational wind cases
        |       F -> solve -> N/V/T/M -> KG -> buckling
        |                         |
        |                         +-> intermodule bolt demands
        |                         +-> member-end weld demands
        |
        +---- lateral unit-load cases
        |       same K -> member/global/bolt limits
        |
        +---- static top-payload search
        |       same K -> member/buckling/bolt checks
        |
        v
calculateConnectionChecks(result)
  physical 4+2 member split at interior joints
  selected bolt + minimum diameter by class
  weld-end envelope + consumable recommendation
        |
        v
buildVerificationPassport(result)
  simple formulas
  equilibrium/residuals
  known-answer frame problems
  dense/reference cross-checks
  explicit external pending levels
        |
        v
Worker result
        +-- UI / 3D viewer
        +-- CSV with weld lengths
        +-- printable project with connection appendix
        +-- internal CalculationSnapshot v7
```

Main thread браузера не выполняет FEM solve.

## 2. Parameter boundaries

Fabrication inputs:

```js
{
  stockBarLengthMm,
  stockBarPieces,
  barDiameterMm,
  reinforcementClass
}
```

Connection inputs:

```js
{
  jointBoltDiameterMm,
  jointBoltClass,
  jointBoltShearPlanes,
  jointEffectiveRadiusMm,
  connectionConditionFactor,
  jointBaseMetalTensileStrengthMPa,
  weldConsumableId,
  weldLegMm,
  weldSegmentsPerEnd,
  weldBetaF,
  weldBetaZ
}
```

До отдельной fabrication model:

```text
ribCutLengthMm = stockBarLengthMm/stockBarPieces
```

Reinforcement catalogue задаёт `E/nu/Ry/Rm/rho/weldability/standard`.

`resolveCalculationParameters()` всегда заново выводит `ribCutLengthMm`, `triangleSideMm`, `moduleHeightMm` и фиксирует `effectiveLengthFactor=0.5` для текущей ideal fixed-fixed member check.

## 3. Connection catalog boundary

`connection-catalog.js` централизованно хранит нормативные данные, чтобы UI/report/tests не имели собственных копий сопротивлений.

Bolt property class entry:

```js
{
  id,
  rbunMPa,
  rbsMPa,
  rbtMPa,
  nutClassForTension
}
```

Bolt size entry:

```js
{
  diameterMm,
  pitchMm,
  grossAreaMm2, // Ab
  netAreaMm2    // Abn
}
```

Weld consumable entry:

```js
{
  id,
  process,
  rwunMPa,
  rwfMPa
}
```

Текущий источник bolted/welded resistances — СП 16.13330.2017; thread size identity — метрическая крупная резьба.

## 4. Weather boundary

`weather.js` разрешает selection в:

```js
{
  windPresetId,
  windPresetLabel,
  beaufortForce,
  windSpeedMs,
  windPressurePa
}
```

Для preset:

```text
q = rho_air*v²/2
rho_air = 1.225 kg/m³
```

Mechanical solver получает уже `windPressurePa`.

## 5. Geometry

Для правильного октаэдра:

```text
R = a/sqrt(3)
h = a*sqrt(2/3)
```

Каждый level содержит три node; соседние уровни повёрнуты на 60°.

Один module:

```text
3 horizontal
6 diagonal
= 9 members
```

Node:

```js
{
  id,
  position: [x,y,z],
  restrained: [ux,uy,uz,rx,ry,rz]
}
```

Нижние три node полностью заделаны.

## 6. Frame element

На node:

```text
[ux,uy,uz,rx,ry,rz]
```

На member — 12 DOF.

Круглое сечение:

```text
A = pi*d²/4
Iy = Iz = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
G = E/[2*(1+nu)]
```

Euler–Bernoulli stiffness использует `EA/L`, `GJ/L`, `12EI/L³`, `6EI/L²`, `4EI/L`, `2EI/L`.

Coordinate transform:

```text
Ke = T^T*ke*T
```

Global ideal joints не имеют moment releases. Это отдельная идеализация от физического connection post-processing.

## 7. Loads

`buildLoadCase()` разделяет:

```js
nodalLoads[nodeId]
nodalMoments[nodeId]
memberDistributedLoads[memberId]
```

Self weight, ice and member wind — distributed loads.

Для uniform transverse load consistent local vector учитывает `qL/2` и `qL²/12`.

Wind cylinder vector:

```text
qwind = p*cd*dout*gamma_w*(ew - ex*(ex dot ew))
```

Осевая компонента исключается.

## 8. Symmetric band K и compile-once

При level-order numbering текущая topology даёт малую полуширину.

Для 40 modules:

```text
123 nodes
738 total DOF
720 free DOF
half-bandwidth = 35
```

Storage/solver complexity:

```text
storage       O(n*b)
factorization O(n*b²)
solve         O(n*b)
```

`compileFrameSystem()` один раз рассчитывает member transforms/properties, free-DOF map, bandwidth, `Kfree`, `Cholesky(Kfree)` и total mass.

Invariant:

```text
stiffnessFactorizationCount = 1
```

## 9. Static solve

Для каждого load case:

```text
assemble F
solve K*u = F
recover local member end actions
recover reactions
build KG from axial forces
solve generalized buckling
```

Member end vector:

```text
fend = ke*ue - feq
```

содержит correlated `N,Vy,Vz,T,My,Mz` на обоих концах. Именно этот vector является источником для connection layer.

Stress recovery:

```text
sigma_N = |N|/A
sigma_M = M/W
tau_T = T*(d/2)/J
tau_V = 4V/(3A)
sigma_eq = sqrt((sigma_N+sigma_M)² + 3*(tau_T²+tau_V²))
```

## 10. Local/global buckling

Local Euler:

```text
Leff = 0.5*L
N_E = pi²*E*I/Leff²/gamma_M
eta_member = max(eta_stress, eta_Euler)
```

Global:

```text
(K + lambda*KG)*phi = 0
A(v) = solve(K, -KG*v)
lambda = 1/mu
```

Lanczos использует K-inner product/reorthogonalization и проверяет actual generalized residual.

## 11. Wind envelope

Полная сетка `0..360` сворачивается modulo 120° только после построения. Удаляются лишь физически эквивалентные directions.

Default 30°:

```text
12 full samples -> 4 unique FEM solves
0,30,60,90 deg
```

## 12. Physical intermodule split

`joint-demand.js` не создаёт нового FEM. Он интерпретирует уже рассчитанный ideal node как физический стык.

Interior node:

```text
4 members lower module
2 upward diagonals next module
1 vertical intermodule bolt
```

Для каждого interior node функция требует **ровно два upward members**. Нарушение topology вызывает error, а не молчаливый другой смысл.

Число физических joints:

```text
3*(moduleCount-1)
```

Foundation nodes excluded.

## 13. Transform member-end actions to joint demand

Local member end actions переводятся в global coordinates через те же local axes, которые использовал frame solver.

Для двух upward members одного load case:

```text
Fjoint = F1 + F2
Mjoint = M1 + M2
```

Bolt axis:

```text
eb = [0,0,1]
```

Direct split:

```text
Faxis = Fjoint dot eb
Fperp = Fjoint - eb*Faxis
```

Rigid frame moment requires explicit physical lever arm:

```text
reff = jointEffectiveRadiusMm
Nt = |Faxis| + |Mb|/reff
Ns = |Fperp| + |T|/reff
```

Этот surrogate намеренно консервативен и зависит от пользовательского `reff`.

## 14. Bolt check

`bolt-check.js` получает один physical demand `{tensionN,shearN}` и выбранную спецификацию.

Capacity:

```text
Nbs = Rbs*Ab*ns*gamma_c
Nbt = Rbt*Abn*gamma_c
```

В текущем single-bolt connection `gamma_b=1` и потому не является отдельным input.

Interaction:

```text
Us = Ns/Nbs
Ut = Nt/Nbt
Ubolt = hypot(Us,Ut)
PASS = Ubolt <= 1
```

Machine-level boundary uses tiny floating tolerance only to avoid `1.0000000000000002` from round-off being reported as physical failure.

Characteristic rupture reference:

```text
Nu = Rbun*Abn
```

хранится отдельно от design capacity.

`minimumBoltForClass()` перебирает allowed standard diameters по возрастанию; `buildBoltRecommendations()` делает это отдельно для каждого supported property class.

## 15. Weld-end check

`buildMemberEndWeldDemands()` формирует два physical ends на каждый member.

Один demand:

```js
{
  memberId,
  end,
  nodeId,
  axialForceN,
  shearForceN,
  torsionNm,
  bendingNm
}
```

Каждый operational case проверяется отдельно. `connection-check.js` выбирает для конкретного physical end case с максимальной required physical weld length.

Exact bead coordinates пока неизвестны, поэтому `weld-check.js` использует circular surrogate:

```text
Qaxial = |N| + 2|M|/rw
Qshear = |V| + |T|/rw
Qw = hypot(Qaxial,Qshear)
```

Resistance per effective millimetre:

```text
Rf/mm = beta_f*kf*Rwf*gamma_c
Rz/mm = beta_z*kf*Rwz*gamma_c
Rwz = 0.45*Run
```

Length:

```text
lw,f = Qw/Rf
lw,z = Qw/Rz
lw,eff = max(lw,f,lw,z,4kf,40 mm)
Lphysical = lw,eff + 10 mm*nsegments
```

Consumable recommendation requires `Rwun >= Run` of weaker parent metal.

## 16. Connection envelope

`calculateConnectionChecks(result)` creates:

```text
connections.method
connections.jointCount
connections.jointDemands[]
connections.bolt.selected
connections.bolt.recommendationsByClass[]
connections.weld.envelope[]
connections.weld.critical
connections.weld.electrodeRecommendation
connections.weld.wireRecommendation
```

Operational connection envelope never merges unrelated cases.

## 17. Lateral capacity

Normalized case:

```text
F0 = 1 N horizontal at top
```

Gravity/wind/ice/equipment disabled.

Now:

```text
Fmember = 1/eta_member(F0)
Fglobal = lambda_cr(F0)*1 N
Fbolt = 1/Ubolt(F0)
Flim = min(Fmember,Fglobal,Fbolt)
```

Direction envelopes for member/global/bolt are independent.

## 18. Static top payload

Trial mass keeps self weight. For each `m`:

```text
Pdesign = m*g*equipmentLoadFactor
U_member(m)
U_bolt(m)
lambda_cr(m)
```

Pass:

```text
U_member <= 1
U_bolt <= 1
lambda_cr >= 1
```

Pure 1 kg without self weight is only an upper-bound reference. Final value uses binary search with self weight.

## 19. Solid-rod sanity boundary

The solid-rod test exists to cross-check scale of the **frame/member** implementation.

Therefore after connection checks were added it intentionally uses:

```text
mast.memberLimitForceN / solid.memberLimitForceN
```

not overall `criticalForceN`, because a real M24 in the artificial `d_rib=a/2` geometry would legitimately become orders of magnitude weaker and destroy the original solver sanity invariant.

## 20. Verification layer

`verification.js` reads complete result and creates evidence levels:

```text
1 simple independent formulas
2 equilibrium + residuals
3 known-answer production-solver benchmarks
4 different numerical algorithms/reference
5 external FEM + expert review = pending
6 physical validation = pending
```

Any internal fail => `verification.status=failed`.

Internal pass with external pending => `internal-passed-external-pending`.

Verification does not claim validation of real joints.

## 21. Worker boundary

```text
Main thread                     Worker
-----------                     ------
form                            calculateCompleteMast
progress UI       <----------   progress
3D viewer         <----------   result/error
paper/CSV export                selectUniformDiameter
```

Cancel uses `worker.terminate()`.

## 22. Diameter optimization boundary

`selectUniformDiameter()` optimizes **rebar diameter** by strength/displacement/global buckling.

Bolt/weld are separate design variables and therefore are not incorrectly used to reject a rebar diameter that cannot repair a weak bolt. After the rebar diameter is selected, the complete calculation always runs connection checks and reports their result.

Future multi-variable optimization may jointly vary rebar/bolt/weld parameters.

## 23. Reporting boundary

UI, CSV and printable project read already-calculated values.

Report renderer must not:

- repeat FEM;
- create an alternative mechanical model;
- recompute governing cases from hidden formulas;
- mix actions from different load cases.

CSV adds required physical weld length at both ends of every member.

Paper report includes dedicated connection section with `Nt/Ns/Nbt/Nbs/Ubolt/Rbun*Abn`, diameter recommendations and weld length calculations.

Internal snapshot:

```text
mast-calculator/calculation-snapshot/v7
```

includes full `connections` and `verification` objects.

## 24. Diagnostics

Each solve retains:

```text
relativeResidual
minPivotRatio
freeDofCount
stiffnessBandwidth
stiffnessFactorizationCount
maximumNodeEquilibriumResidual
globalMomentResidual
buckling residual/eigenResidual/iterations
```

Connection layer additionally retains governing level/node/load case and demand/capacity/utilization.

## 25. 40-module regression

Required CI case:

```text
modules = 40
free DOF = 720
bandwidth <= 35
factorizations = 1
wind cases = 4
lateral cases = 8
static payload evaluations = fixed bounded count
internal bolt joints = 117
weld envelope entries = 2 * member count
finite lateral bolt limit
finite static bolt utilization
verification.failed = 0
verification levels 1..4 = PASS
runtime < generous CI guard
```

Performance guard detects regression to minute-scale dense behavior rather than promising identical time on all hardware.

## 26. External engineering verification

Internal checks do not replace external FEM or a detailed joint model.

External reference should match:

```text
coordinates/topology
restraints/releases
E/nu/A/I/J
loads and units
```

and compare:

```text
displacements/rotations
reactions/moments
N/V/T/M
stresses
buckling eigenvalues/modes
joint resultants
```

For exact connection validation additionally model actual bolt/nut/washer/thread/weld geometry.

## 27. CI completion rule

Calculation change is complete only after:

```text
syntax + maintainability
CI policy tests
Linux tests
macOS tests
Windows tests
secret scan
static-site smoke
```

Static smoke must load connection catalog/check modules, verification, Worker, solver, report modules and CSS.

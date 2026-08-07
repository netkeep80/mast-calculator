# Архитектура расчётного ядра

Статус: архитектура прототипа 1.0.

Документ фиксирует границы между практическим вводом, геометрией, global 3D frame FEM, solver, physical connection post-processing, специальными предельными cases, verification, Worker и отчётностью.

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
        |
        v
Worker result
        +-- UI / 3D viewer
        +-- CSV with weld lengths
        +-- printable project
        +-- internal CalculationSnapshot v7
```

Main thread браузера не выполняет FEM solve.

## 2. Границы параметров

Fabrication input:

```js
{
  stockBarLengthMm,
  stockBarPieces,
  barDiameterMm,
  reinforcementClass
}
```

Connection input:

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

`resolveCalculationParameters()` выводит:

```text
ribCutLengthMm = stockBarLengthMm/stockBarPieces
triangleSideMm = ribCutLengthMm
moduleHeightMm = ribCutLengthMm*sqrt(2/3)
effectiveLengthFactor = 0.5
```

Reinforcement catalogue задаёт `E/nu/Ry/Rm/rho/weldability/standard`.

## 3. Connection catalog boundary

`connection-catalog.js` централизованно хранит нормативные данные.

Bolt property class:

```js
{
  id,
  rbunMPa,
  rbsMPa,
  rbtMPa,
  nutClassForTension
}
```

Bolt size:

```js
{
  diameterMm,
  pitchMm,
  grossAreaMm2, // Ab
  netAreaMm2    // Abn
}
```

Weld consumable:

```js
{
  id,
  process,
  rwunMPa,
  rwfMPa
}
```

UI, report и tests не должны иметь собственные копии нормативных resistance tables.

## 4. Geometry и frame model

Для regular octahedron:

```text
R = a/sqrt(3)
h = a*sqrt(2/3)
```

Каждый level содержит три node; соседние levels повёрнуты на 60°. Один module содержит `3 horizontal + 6 diagonal = 9 members`.

Node:

```js
{
  id,
  position: [x,y,z],
  restrained: [ux,uy,uz,rx,ry,rz]
}
```

Каждый round Euler–Bernoulli member имеет 12 DOF и свойства:

```text
A = pi*d²/4
Iy = Iz = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
G = E/[2*(1+nu)]
```

Global ideal joints не имеют moment releases. Реальная конечная жёсткость соединения пока не возвращается в global `K`.

## 5. Loads

`buildLoadCase()` разделяет:

```js
nodalLoads[nodeId]
nodalMoments[nodeId]
memberDistributedLoads[memberId]
```

Self weight, ice и member wind являются distributed member loads. Uniform transverse load использует consistent nodal vector с `qL/2` и `qL²/12`.

Для круглого member ветер использует только normal component относительно оси элемента.

## 6. Compile once, solve many

`compileFrameSystem()` один раз вычисляет:

```text
member transforms/properties
free DOF map
symmetric band K
Cholesky(K)
total mass
```

Для 40 modules regression ожидает:

```text
720 free DOF
half-bandwidth <= 35
stiffnessFactorizationCount = 1
```

Storage/solver complexity:

```text
storage       O(n*b)
factorization O(n*b²)
solve         O(n*b)
```

## 7. Static solve и member actions

Для каждого load case:

```text
assemble F
solve K*u = F
recover local member end actions
recover reactions
build KG
solve generalized buckling
```

Member end vector:

```text
fend = ke*ue - feq
```

содержит correlated `N,Vy,Vz,T,My,Mz` на обоих концах. Именно этот вектор является источником connection layer.

Member stress recovery:

```text
sigma_N = |N|/A
sigma_M = M/W
tau_T = T*(d/2)/J
tau_V = 4V/(3A)
sigma_eq = sqrt((sigma_N+sigma_M)² + 3*(tau_T²+tau_V²))
```

Local Euler:

```text
Leff = 0.5*L
N_E = pi²*E*I/Leff²/gamma_M
eta_member = max(eta_stress, eta_Euler)
```

## 8. Global buckling

Generalized eigenproblem:

```text
(K + lambda*KG)*phi = 0
```

Matrix-free operator:

```text
v -> -KG*v -> solve(K, ...) -> K^-1(-KG)v
```

Lanczos использует K-inner product/reorthogonalization и проверяет actual generalized residual.

## 9. Physical intermodule split

`joint-demand.js` интерпретирует interior ideal FEM node как physical stacking joint:

```text
lower module:
  2 incoming diagonals
  2 horizontal members
  = 4 members

upper module:
  2 upward diagonals
  = 2 members

one vertical bolt joins 4-member and 2-member parts
```

Для каждого interior node функция требует ровно два upward members. Нарушение topology вызывает error.

Число внутренних болтов:

```text
3*(moduleCount-1)
```

Foundation nodes исключены.

## 10. Member-end actions -> bolt demand

Local end actions двух upward members одного load case переводятся в global coordinates и суммируются:

```text
Fjoint = F1 + F2
Mjoint = M1 + M2
```

Bolt axis:

```text
eb = [0,0,1]
Faxis = Fjoint dot eb
Fperp = Fjoint - eb*Faxis
```

Критически важна знаковая интерпретация end force для отсечённой верхней части:

```text
Faxis > 0 -> contact compression
Faxis < 0 -> joint separation
```

Поэтому direct bolt tension:

```text
Nt,direct = max(0,-Faxis)
Ncontact = max(0,Faxis)
```

`abs(Faxis)` здесь запрещён: он превратил бы обычное вертикальное сжатие от собственного веса/бака в фиктивное растяжение болта.

Rigid frame moment требует явного physical lever arm:

```text
reff = jointEffectiveRadiusMm
Nt = max(0,-Faxis) + |Mb|/reff
Ns = |Fperp| + |T|/reff
```

Contact compression пока не вычитается из `|Mb|/reff`: без exact contact-pressure model программа не кредитует неизвестную область контакта как полностью снимающую prying. Это conservative surrogate.

## 11. Bolt capacity

`bolt-check.js` получает coincident physical demand `{tensionN,shearN}`.

```text
Nbs = Rbs*Ab*ns*gamma_c
Nbt = Rbt*Abn*gamma_c
Us = Ns/Nbs
Ut = Nt/Nbt
Ubolt = hypot(Us,Ut)
PASS = Ubolt <= 1
```

В текущем single-bolt connection `gamma_b=1`.

Machine-level tolerance около `U=1` используется только против floating-point round-off.

Characteristic rupture reference хранится отдельно:

```text
Nu = Rbun*Abn
```

и не является design/allowable capacity.

`minimumBoltForClass()` перебирает стандартные диаметры по возрастанию; `buildBoltRecommendations()` выполняет это отдельно для каждого supported property class.

## 12. Weld-end check

Каждый physical member end получает coincident vector одного load case:

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

Каждый operational case проверяется отдельно. В envelope конкретного physical end попадает case с максимальной required physical weld length.

Exact coordinates отдельных beads пока неизвестны, поэтому используется explicit circular surrogate:

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

Required length:

```text
lw,f = Qw/Rf
lw,z = Qw/Rz
lw,eff = max(lw,f,lw,z,4kf,40 mm)
Lphysical = lw,eff + 10 mm*nsegments
```

Consumable recommendation requires `Rwun >= Run` более слабого parent metal.

## 13. Connection envelope

`calculateConnectionChecks(result)` создаёт:

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

Operational connection envelope никогда не смешивает actions разных load cases.

## 14. Lateral capacity

Normalized case:

```text
F0 = 1 N horizontal at top
```

Gravity/weather/equipment disabled.

```text
Fmember = 1/eta_member(F0)
Fglobal = lambda_cr(F0)*1 N
Fbolt = 1/Ubolt(F0)
Flim = min(Fmember,Fglobal,Fbolt)
```

Member/global/bolt governing directions сохраняются отдельно.

## 15. Static top payload

Каждый trial mass сохраняет self weight и проверяет:

```text
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

Pure `1 kg` without self weight используется только как upper-bound reference. Final value ищется binary search с self weight.

Физический invariant connection layer: увеличение чистого vertical compression не создаёт direct bolt tension; bolt demand появляется только из separating/shear/moment components рассчитанного state.

## 16. Solid-rod sanity boundary

Solid-rod regression существует для проверки масштаба frame/member implementation, поэтому после добавления physical bolt check сравнивает:

```text
mast.memberLimitForceN / solid.memberLimitForceN
```

а не overall `criticalForceN=min(member,global,bolt)`.

Иначе default M24 в искусственной `d_rib=a/2` geometry закономерно становился бы слабейшим звеном и переставал бы тестироваться исходный frame invariant.

## 17. Verification layer

`verification.js` строит evidence levels:

```text
1 simple independent formulas
2 equilibrium + residuals
3 known-answer production-solver benchmarks
4 different numerical algorithms/reference
5 external FEM + expert review = pending
6 physical validation = pending
```

Any internal fail => `verification.status=failed`.

Internal pass with external pending =>:

```text
internal-passed-external-pending
```

Verification не объявляет validation реального bolted/welded joint.

## 18. Worker и reporting boundaries

```text
Main thread                     Worker
-----------                     ------
form                            calculateCompleteMast
progress UI       <----------   progress
3D viewer         <----------   result/error
paper/CSV export                selectUniformDiameter
```

Cancel выполняется `worker.terminate()`.

UI/CSV/paper report читают уже рассчитанный result object и не имеют права повторно запускать FEM или составлять другой governing load case.

CSV содержит required physical weld length обоих ends каждого member.

Paper report содержит dedicated connection section с `Nt/Ns/Nbt/Nbs/Ubolt/Rbun*Abn`, diameter recommendations и weld-length calculations.

Internal snapshot:

```text
mast-calculator/calculation-snapshot/v7
```

включает полный `connections` и `verification` objects.

## 19. Rebar optimization boundary

`selectUniformDiameter()` оптимизирует **диаметр арматуры** по member strength/displacement/global buckling.

Bolt/weld являются отдельными design variables: слабый bolt нельзя исправить увеличением rebar diameter. После выбора rebar complete calculation всегда выполняет connection checks и показывает их результат.

Future multi-variable optimization может совместно варьировать rebar/bolt/weld.

## 20. Diagnostics и regression

Каждый solve сохраняет:

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

Connection layer сохраняет governing level/node/load case и demand/capacity/utilization.

40-module CI case дополнительно проверяет:

```text
3*(40-1) = 117 internal bolt joints
one weld-envelope item per physical member end
finite lateral bolt limit
finite static-payload bolt utilization
verification levels 1..4 PASS
```

Analytical connection regressions включают:

```text
M24 8.8 table capacities
combined 0.6/0.8 -> U=1
100 kN pure tension -> M20 for class 8.8
Faxis=+10 kN compression -> Nt,direct=0
Faxis=-10 kN separation -> Nt,direct=10 kN
weak bolt can govern lateral limit
weld pure-axial length formula
```

## 21. External validation boundary

Internal checks не заменяют external FEM, engineering review или detailed joint model.

Для exact connection validation нужны фактические размеры:

- nut/washer/contact geometry;
- external/internal thread engagement;
- bearing surfaces;
- weld bead coordinates and lengths;
- preload/slip condition;
- foundation connection.

После их появления connection layer можно расширить exact thread stripping, bearing/prying, exact weld-group `W/Ix/Iy` и finite joint stiffness без изменения базового frame solver.

## 22. CI completion rule

Calculation change считается завершённым только после:

```text
syntax + maintainability
CI policy tests
Linux tests
macOS tests
Windows tests
secret scan
static-site smoke
```

Static smoke загружает connection catalog/check modules, verification, Worker, solver, report modules и CSS.

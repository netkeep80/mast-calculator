# Архитектура расчётного ядра

Статус: архитектура прототипа **1.1**.

Этот документ фиксирует границы между физическим модулем, global 3D frame FEM, точной помодульной Schur-конденсацией, global eigen-buckling, physical connection checks, поиском предельной высоты, verification, Worker и отчётностью.

## 1. Общий поток

```text
Practical input
  stock/cutting/rebar/material/weather/loads
  bolt/weld parameters
  height search limit
        |
        v
Parameter resolution
  a = Lstock/nparts
  h = a*sqrt(2/3)
  material + weather + connection catalogues
        |
        v
Physical geometry
  N identical octahedron modules, legs down
  3 top-ring + 6 legs per module
  member.moduleIndex / role
        |
        +-------------------------------+
        |                               |
        v                               v
compileFrameSystem()              compileModuleStack()
  global banded K                   36-DOF module K
  Cholesky(K) once                  18-DOF interfaces
        |                           top-down Schur factors
        |                               |
        +------------ load case --------+
        |                               |
        v                               v
global solve K*u=F              modular top-down condensation
  N/V/T/M                         + bottom-up recovery
  reactions                       interface F/M
  KG                              module state
        |                               |
        +------- cross-check ------------+
        |  u_global ≈ u_modular
        |  interface equilibrium
        v
full-mast eigen-buckling
  (K + lambda*KG)*phi = 0
        |
        +-- operational wind envelope
        +-- lateral unit-load capacity
        +-- static top-payload capacity
        +-- maximum integer module count
        |
        v
connection post-processing
  intermodule bolt
  weld-end envelopes
        |
        v
verification + Worker result
        +-- full mast viewer
        +-- selected-module viewer
        +-- grouped/sortable member report
        +-- CSV
        +-- printable project
        +-- CalculationSnapshot v8
```

Main thread не выполняет FEM solve или height search.

## 2. Physical module boundary

Физический модуль всегда установлен **ножками вниз**.

```text
bottom interface = 3 опорных node
top interface    = 3 node верхнего треугольника
members          = 3 top-ring + 6 leg = 9
```

Соседние уровни повёрнуты на 60°.

Для мачты из `N` модулей:

```text
levels  = N + 1
nodes   = 3*(N+1)
members = 9*N
```

Верхний треугольник последнего модуля является его собственными `top-ring` members. Специального `closeTopRing` нет.

Каждый member хранит:

```js
{
  id,
  nodeA,
  nodeB,
  moduleIndex,
  role: 'top-ring' | 'leg',
  diameterM,
  youngModulusPa,
  yieldStrengthPa,
  tensileStrengthPa,
  ...
}
```

Каждый module хранит:

```js
{
  index,
  number,
  bottomNodeIds: [3],
  topNodeIds: [3],
  memberIds: [9]
}
```

## 3. Global frame element

Node DOF:

```text
[ux,uy,uz,rx,ry,rz]
```

Member имеет 12 DOF.

Для круглого сечения:

```text
A = pi*d²/4
Iy = Iz = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
G = E/[2*(1+nu)]
```

Local Euler–Bernoulli stiffness использует `EA/L`, `GJ/L`, `12EI/L³`, `6EI/L²`, `4EI/L`, `2EI/L`.

Transform:

```text
Ke = T^T*ke*T
```

Global geometric nodes пока идеализированы абсолютно жёсткими.

## 4. Foundation boundary

Три нижних node первого модуля имеют:

```text
[true,true,true,true,true,true]
```

то есть ideal rigid fixation. Реальный foundation будет отдельным physical layer.

## 5. Loads

`buildLoadCase()` выдаёт:

```js
nodalLoads[nodeId]
nodalMoments[nodeId]
memberDistributedLoads[memberId]
```

Self weight, ice и wind on members являются distributed loads.

Для uniform local transverse load consistent vector содержит:

```text
qL/2
qL²/12
```

и одинаково используется global и modular solver paths.

## 6. Global banded system

`compileFrameSystem()` один раз на геометрию создаёт:

```text
member geometry/local axes/transforms
free DOF map
symmetric band K
Cholesky(K)
member section properties
total mass
```

При level-order numbering текущая topology локальна по соседним уровням.

Для 40 modules:

```text
123 nodes
738 total DOF
720 free DOF
half-bandwidth = 35
```

Основной complexity:

```text
storage       O(n*b)
factorization O(n*b²)
solve         O(n*b)
```

Invariant complete calculation:

```text
stiffnessFactorizationCount = 1
```

## 7. Global static solve

Для load case:

```text
assemble F
solve K*u=F
recover local member end actions
recover reactions
build KG
```

Member end vector:

```text
fend = ke*ue - feq
```

возвращает coincident:

```text
N,Vy,Vz,T,My,Mz
```

на обоих концах.

Stress recovery:

```text
sigma_N = |N|/A
sigma_M = M/W
tau_T = T*(d/2)/J
tau_V = 4V/(3A)
sigma_eq = sqrt((sigma_N+sigma_M)² + 3*(tau_T²+tau_V²))
```

## 8. Exact modular static solver

Один module — 36-DOF substructure:

```text
bottom interface: 18 DOF
top interface:    18 DOF
```

После assembly девяти member:

```text
[ Kbb Kbt ] [ub] = [fb]
[ Ktb Ktt ] [ut]   [ft]
```

Уже condensed upper stack задаётся парой `(Supper,pupper)`.

Top-down step:

```text
A = Ktt + Supper
ut = A^-1*(ft+pupper-Ktb*ub)

S = Kbb - Kbt*A^-1*Ktb
p = fb - Kbt*A^-1*(ft+pupper)
```

`S,p` становятся equivalent stiffness/load для top interface следующего нижнего module.

На самом верху:

```text
Supper = 0
pupper = 0
```

После condensation всех modules основание известно:

```text
u0 = 0
```

и выполняется bottom-up back-substitution для всех interfaces.

Это **точная линейная Schur condensation**, а не суммирование только вертикальных сил. Она сохраняет translations, rotations, forces, moments и stiffness upper stack.

## 9. Assignment of loads to modules

Каждый distributed member load принадлежит ровно тому physical module, которому принадлежит member.

Direct nodal load на общем interface присваивается один раз — module непосредственно ниже interface.

Так предотвращается double counting при сумме module load vectors.

## 10. Module interface result

После восстановления displacement для isolated module вычисляется:

```text
r_module = K_module*u_module - f_module
```

Bottom 18 components — action/reaction на нижнем interface.

Top 18 components — action всего upper stack, необходимое для equilibrium текущего module.

Output по каждому interface node:

```js
{
  nodeId,
  forceN: [Fx,Fy,Fz],
  momentNm: [Mx,My,Mz]
}
```

Module result дополнительно хранит critical member и vertical overload discriminator.

## 11. Modular/global cross-check

Для каждого operational case сравниваются все 6 DOF всех node:

```text
relativeDifference = ||u_modular-u_global|| / ||u_global||
```

Threshold:

```text
relativeDifference < 1e-8
```

На общем interface двух соседних physical modules:

```text
Ftop,lower + Fbottom,upper = 0
Mtop,lower + Mbottom,upper = 0
```

Normalized interface residual также должен быть `<1e-8`.

Таким образом новая декомпозиция одновременно является computational path и independent assembly cross-check старого global path.

## 12. Local member stability and rupture discriminator

Основная member design check остаётся:

```text
Umember = max(Ustress,UEuler)
```

где:

```text
Leff = 0.5*L
NE = pi²*E*I/Leff²/gamma_M
UEuler = Ncompression/NE
```

Для issue #18 отдельно требуется различать два vertical overload mechanisms ножек module:

```text
Ubuckling = UEuler
Nrupture = (Rm/gamma_M)*A
Urupture = Ntension/Nrupture
```

`verticalFailureMode` выбирается между:

```text
local-member-buckling
tensile-rupture
```

Это discriminator, а не замена основной yield/von-Mises design check.

## 13. Global eigen-buckling boundary

После global static solve строится `KG` и решается:

```text
(K + lambda*KG)*phi = 0
```

Рабочий matrix-free operator:

```text
v -> -KG*v -> solve(K,...) -> K^-1(-KG)v
```

Generalized Lanczos работает в `K`-inner product и подтверждает eigenpair фактической residual исходной задачи.

**Global buckling не декомпозируется на независимые module checks.** Общая mode может охватывать несколько или все modules.

## 14. Operational wind envelope

Full user direction grid сначала строится, затем exact 120° rotational symmetry удаляет только physical duplicates.

Default 30°:

```text
12 full-circle directions
-> 4 unique FEM solves
0,30,60,90 deg
```

Каждый case получает global solve + modular cross-check.

## 15. Connection layer

Physical connection checks не создают вторую FEM.

Intermodule bolt demand строится из coincident end-actions одного load case.

Current bolt surrogate:

```text
Nt = max(0,-Faxis) + |Mb|/reff
Ns = |Fperp| + |T|/reff
```

Bolt capacity:

```text
Nbs = Rbs*Ab*ns*gamma_b*gamma_c
Nbt = Rbt*Abn*gamma_c
Ubolt = sqrt((Ns/Nbs)²+(Nt/Nbt)²)
```

Weld layer проверяет physical ends каждого member по coincident `N/V/T/M`.

Подробности: [`CONNECTIONS.md`](CONNECTIONS.md).

## 16. Lateral capacity

Clean normalized case:

```text
F0 = 1 N horizontal at top
```

Operational wind/gravity/ice/equipment выключены.

```text
Fmember = 1/Umember(F0)
Fglobal = lambda_cr(F0)*1N
Fbolt = 1/Ubolt(F0)
Flim = min(Fmember,Fglobal,Fbolt)
```

## 17. Static top payload

Gravity-only trial mass сохраняет self weight:

```text
Pdesign = m*g*equipmentLoadFactor
U_member(m)
U_bolt(m)
lambda_cr(m)
```

Pass:

```text
U_member<=1
U_bolt<=1
lambda_cr>=1
```

Final limit определяется binary search с self weight.

## 18. Maximum height search

Height candidate определяется целым числом одинаковых modules:

```text
H(N)=N*h
```

Design criteria:

```text
Umember<=1
Ubolt<=1
lambda_cr>=minimumBucklingFactor
delta_top<=displacementLimit
```

Ultimate-resistance criteria:

```text
Umember<=1
Ubolt<=1
lambda_cr>=1
```

Search:

```text
exponential bracketing
binary search
local integer neighbourhood scan
```

Local scan учитывает parity effect от alternating 60° module orientation.

Если до `heightSearchMaxModules` failure не найден, result помечается `bounded=false`, а UI показывает `>=Hsearch`.

## 19. Verification layer

Base verification строится из complete engine result.

User-facing Worker дополнительно вызывает `augmentVerificationWithModuleChecks()` и добавляет:

```text
level 1: module legs-down topology
level 2: module interface force/moment equilibrium
level 4: modular Schur vs global FEM displacement vector
```

External FEM, expert review и physical validation остаются pending.

## 20. Worker boundary

```text
Main thread                     Worker
-----------                     ------
form                            calculateCompleteMast
progress UI       <----------   progress
full viewer       <----------   result
module viewer     <----------   result
reports/export                  final augmented verification
```

Cancel:

```js
worker.terminate()
```

Main thread не импортирует `calculateMast()`/`calculateCompleteMast()`.

## 21. UI/reporting boundary

Main viewer знает `member.moduleIndex` и позволяет click selection.

Selected-module viewer читает:

```text
module member results
module topAppliedFromAbove
module bottomReactionFromBelow
direct nodal load
```

Member envelope UI может group by module и sort by chosen numeric field.

Report renderers не решают FEM повторно.

## 22. Internal snapshot

Current schema:

```text
mast-calculator/calculation-snapshot/v8
```

Новые fields:

```text
model.modules
member.moduleIndex / role
loadCases[].analysis.modular
heightCapacity
modular diagnostics
```

## 23. Diagnostics

Global solve сохраняет:

```text
relativeResidual
minPivotRatio
maximumNodeEquilibriumResidual
globalMomentResidual
buckling residual/eigenResidual
```

Modular path сохраняет:

```text
relativeDisplacementDifference
interfaceEquilibriumResidual
interfaceFactorizationCount
```

Bad diagnostics должны создавать warning/verification fail.

## 24. Performance invariants

40-module global geometry:

```text
free DOF = 720
half-bandwidth <= 35
stiffnessFactorizationCount = 1
```

Modular static path использует `N` малых 18×18 factorization instead of dense global inverse.

Height search обязан использовать bracket/binary strategy, а не full linear scan до search limit.

## 25. Незакрытые physical layers

Current architecture намеренно не включает:

```text
P-Delta / geometric nonlinearity
initial imperfections
plasticity
finite joint/contact stiffness
thread stripping / actual engagement
bearing/prying/preload/slip
exact weld bead coordinates
fatigue
parameterized foundation
complete normative load combinations
external FEM validation
```

При добавлении nonlinear effects modular Schur workflow должен быть пересмотрен как incremental/nonlinear substructuring, а не использован без изменения.

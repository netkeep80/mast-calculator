# Требования к Mast Calculator

Статус: рабочая спецификация прототипа **1.1**.

Специализированные документы:

- [`CALCULATION_ARCHITECTURE.md`](CALCULATION_ARCHITECTURE.md) — global FEM и численный solver;
- [`MODULAR_ANALYSIS_AND_HEIGHT.md`](MODULAR_ANALYSIS_AND_HEIGHT.md) — issue #18: одинаковые модули, Schur substructuring, визуализация и предельная высота;
- [`CONNECTIONS.md`](CONNECTIONS.md) — межмодульный болт и сварка;
- [`VERIFICATION_FOR_NON_SPECIALISTS.md`](VERIFICATION_FOR_NON_SPECIALISTS.md) — verification passport;
- [`LATERAL_CAPACITY_WEATHER_VALIDATION.md`](LATERAL_CAPACITY_WEATHER_VALIDATION.md) — боковая нагрузка и погода;
- [`STATIC_PAYLOAD_CAPACITY.md`](STATIC_PAYLOAD_CAPACITY.md) — статическая масса на вершине;
- [`PERFORMANCE_AND_PROGRESS.md`](PERFORMANCE_AND_PROGRESS.md) — Worker/performance;
- [`CI_CD_REVIEW.md`](CI_CD_REVIEW.md) — CI/CD.

## 1. Цель

Mast Calculator — статическое browser-приложение для расчёта мачты, собираемой из одинаковых сварных арматурных октаэдров.

Обязательные принципы:

1. backend отсутствует, публикация выполняется через GitHub Pages;
2. пользователь вводит реальные fabrication/load parameters, а не внутренние FEM-константы;
3. каждый physical module имеет однозначную принадлежность узлов и рёбер;
4. static response проверяется двумя вычислительными путями: global FEM и modular Schur stack;
5. global buckling остаётся задачей всей связанной мачты;
6. physical bolt/weld checks получают совпадающие `N/V/T/M` одного load case;
7. все ограничения и непроверенные assumptions видимы пользователю;
8. paper project и internal snapshot воспроизводят тот же calculated result;
9. calculation changes проходят CI на Linux/macOS/Windows.

Приложение не является сертификатом изготовленной конструкции.

## 2. Практический ввод

Основные параметры:

```text
moduleCount
stockBarLengthMm
stockBarPieces
barDiameterMm
reinforcementClass
weather/wind parameters
ice parameters
equipment mass / wind area
extra horizontal / vertical loads
```

Connection parameters:

```text
jointBoltDiameterMm
jointBoltClass
jointBoltShearPlanes
jointEffectiveRadiusMm
connectionConditionFactor
jointBaseMetalTensileStrengthMPa
weldConsumableId
weldLegMm
weldSegmentsPerEnd
weldBetaF
weldBetaZ
```

Advanced limits:

```text
materialSafetyFactor
deadLoadFactor
windLoadFactor
equipmentLoadFactor
displacementLimitMm
minimumBucklingFactor
lateralCapacityStepDeg
heightSearchMaxModules
```

Не вводятся вручную:

```text
ribCutLengthMm
moduleHeightMm
E / nu / Ry / Rm / density
effectiveLengthFactor текущей fixed-fixed idealization
```

## 3. Геометрия одинакового физического модуля

До учёта kerf/trim/joint overlap:

```text
a = Lstock/nparts
R = a/sqrt(3)
h = a*sqrt(2/3)
H = N*h
```

Соседние треугольные уровни повёрнуты на 60°.

**Модуль всегда устанавливается ножками вниз.** Его собственная структура:

```text
верхняя грань: 3 horizontal top-ring members
нижняя грань: 3 опорные точки
между ними: 6 diagonal leg members
итого: 9 members/module
```

Следствия:

```text
members total = 9*N
```

Верхний треугольник последнего модуля — не искусственное замыкание: это три horizontal member самого последнего physical module.

`closeTopRing` больше не является расчётным параметром.

Каждый member обязан хранить:

```text
moduleIndex
role = top-ring | leg
```

Каждый module обязан хранить:

```text
bottomNodeIds[3]
topNodeIds[3]
memberIds[9]
```

Regression invariant: все девять геометрических рёбер каждого правильного октаэдра имеют длину `a`.

## 4. Фундаментная граница

Три нижних node первого модуля пока считаются идеальной жёсткой заделкой:

```text
ux=uy=uz=rx=ry=rz=0
```

Параметрический foundation model является отдельным будущим этапом.

## 5. Global 3D frame model

Node DOF:

```text
[ux,uy,uz,rx,ry,rz]
```

Member — 12-DOF spatial Euler–Bernoulli frame element.

Круглое сечение:

```text
A = pi*d²/4
Iy = Iz = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
G = E/[2*(1+nu)]
```

Element stiffness учитывает:

```text
EA
EIy
EIz
GJ
```

Recovered member actions:

```text
N
Vy,Vz
T
My,Mz
```

Global solver использует symmetric band storage и Cholesky factorization.

## 6. Loads

Operational cases поддерживают:

- self weight;
- cylindrical ice layer;
- wind on spatial round members;
- equipment mass;
- equipment wind area;
- extra horizontal load;
- extra vertical load;
- wind-direction envelope.

Self weight, ice и member wind являются distributed element loads.

Uniform transverse consistent load vector содержит `qL/2` и `qL²/12`.

Для круглого member ветер определяется только normal component относительно оси стержня.

## 7. Weather

UI поддерживает Beaufort 0–12 и custom pressure.

Для preset:

```text
q = rho_air*v²/2
rho_air = 1.225 kg/m³
```

Beaufort — сравнительный UX scenario и не заменяет normative wind design по СП 20.

## 8. Member strength

Current elastic check:

```text
sigma_N = |N|/A
sigma_M = M/W
sigma = sigma_N + sigma_M

tau_T = T*(d/2)/J
tau_V = 4V/(3A)
tau = sqrt(tau_T² + tau_V²)

sigma_eq = sqrt(sigma² + 3*tau²)
Ustress = sigma_eq/(Ry/gamma_M)
```

Distributed transverse load должна учитывать возможный internal moment maximum.

## 9. Local Euler check

```text
Leff = 0.5*L
NE = pi²*E*I/Leff²/gamma_M
UEuler = Ncompression/NE
Umember = max(Ustress,UEuler)
```

Это elastic engineering check, не полный normative member design СП 16.

## 10. Global linear buckling

После static solve:

```text
(K + lambda*KG)*phi = 0
```

Сохраняются:

```text
criticalLoadFactor
mode translations
mode rotations
residual/eigenResidual
iterations
```

Matrix-free generalized Lanczos подтверждает eigenpair actual generalized residual.

Global buckling **не заменяется последовательной независимой проверкой модулей**, потому что mode может охватывать всю мачту.

## 11. Exact modular static solver — issue #18

Каждый physical module рассматривается как substructure с двумя 18-DOF interfaces:

```text
bottom = 3 nodes * 6 DOF
top    = 3 nodes * 6 DOF
```

Module stiffness:

```text
[ Kbb Kbt ] [ub] = [fb]
[ Ktb Ktt ] [ut]   [ft]
```

Already condensed upper stack задаёт `(Supper,pupper)`.

Top-down Schur step:

```text
A = Ktt + Supper
S = Kbb - Kbt*A^-1*Ktb
p = fb - Kbt*A^-1*(ft+pupper)
```

После достижения rigid foundation выполняется bottom-up back-substitution:

```text
ut = A^-1*(ft+pupper-Ktb*ub)
```

Это точная linear condensation текущей FEM, а не приблизительное суммирование вертикальных сил.

## 12. Modular/global cross-check

Для каждого operational load case обязательны:

```text
||u_modular-u_global|| / ||u_global|| < 1e-8
interface force/moment residual < 1e-8
```

На общем interface соседних modules:

```text
Ftop,lower + Fbottom,upper = 0
Mtop,lower + Mbottom,upper = 0
```

Нарушение допусков должно давать warning/verification failure, а не скрываться.

## 13. Module result

Каждый module/load case должен содержать минимум:

```text
moduleNumber
memberIds[9]
topAppliedFromAbove[3]
bottomReactionFromBelow[3]
topResultantFromAbove
bottomResultantFromBelow
criticalMemberId
maxUtilization
maxStressUtilization
maxBucklingUtilization
maxRuptureUtilization
verticalFailureMode
verticalFailureMemberId
```

Interface action:

```text
nodeId
forceN[3]
momentNm[3]
```

## 14. Detailed module visualization

Main 3D view должна позволять выбрать module:

```text
click on member
or module selector
```

Selected module подсвечивается в общей мачте.

Second canvas показывает только selected module:

- nine members;
- node IDs;
- `N/V/M` labels;
- forces/moments from upper stack;
- reactions from lower stack/foundation;
- direct nodal loads;
- critical member and vertical failure mechanism.

Табличная часть показывает component-wise `Fx/Fy/Fz/Mx/My/Mz` на каждом interface node и `N/V/T/M/U` каждого member.

## 15. Member envelope table

Member report обязан поддерживать:

```text
group by module | no grouping
sort by module/member/|N|/V/M/sigma_eq/wind/utilization
asc | desc
```

CSV должен включать physical module number.

## 16. Maximum height — issue #18

Height search выполняется по целому `N`:

```text
H(N)=N*h
```

Каждый candidate использует текущие выбранные material, bolt, wind, ice, equipment и load factors.

### Design height

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= minimumBucklingFactor
delta_top <= displacementLimit
```

### Ultimate-resistance height

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= 1
```

Displacement serviceability здесь не ограничивает resistance boundary.

Search algorithm:

```text
exponential bracketing
binary refinement
local integer neighbourhood check
```

Если failure не найден до `heightSearchMaxModules`, результат обязан показываться как lower bound `>=Hsearch`, а не как ложный finite maximum.

## 17. Bottom module overload discriminator

Для six leg members нижнего module отдельно сравниваются два механизма, требуемые issue #18.

Local instability:

```text
Ubuckling = existing Euler utilization
```

Tensile rupture reference:

```text
Nrupture = (Rm/gamma_M)*A
Urupture = Ntension/Nrupture
```

Для wind envelope выбирается худший coincident load case. Output:

```text
local-member-buckling | tensile-rupture
governing member
wind direction
Ubuckling
Urupture
reserve factor
```

Это отдельный overload discriminator. Основной elastic member design по `Ry` не заменяется `Rm`.

## 18. Physical intermodule joint

Для internal stacking joint используется physical split между соседними modules и один vertical bolt.

Количество:

```text
Njoints = 3*(N-1)
```

Bolt demand строится из coincident forces/moments одного load case.

Axis:

```text
eb=[0,0,1]
Faxis = Fjoint dot eb
Fperp = Fjoint-eb*Faxis
```

С учётом правильного знака contact compression:

```text
Nt = max(0,-Faxis) + |Mb|/reff
Ns = |Fperp| + |T|/reff
```

Compression не превращается в fictitious tension и пока не используется как relief против prying moment.

## 19. Bolt check

```text
Nbs = Rbs*Ab*ns*gamma_b*gamma_c
Nbt = Rbt*Abn*gamma_c
Ubolt = sqrt((Ns/Nbs)²+(Nt/Nbt)²)
PASS if Ubolt<=1
```

Characteristic rupture:

```text
Nu = Rbun*Abn
```

не называется allowable load.

Automatic size recommendation выполняется отдельно по supported property classes.

## 20. Weld-end check

Каждый physical member end использует coincident:

```text
N,Vy,Vz,T,My,Mz
```

Current circular surrogate:

```text
Qaxial = |N|+2|M|/rw
Qshear = |V|+|T|/rw
Qw = hypot(Qaxial,Qshear)
Rwz = 0.45*Run
lw,f = Qw/(beta_f*kf*Rwf*gamma_c)
lw,z = Qw/(beta_z*kf*Rwz*gamma_c)
lw = max(lw,f,lw,z,4kf,40mm)
Lphysical = lw+10mm*nsegments
```

Exact weld bead geometry остаётся future input.

## 21. Lateral capacity

Clean unit-load case:

```text
F0=1N horizontal at top
Fmember=1/Umember(F0)
Fglobal=lambda_cr(F0)*1N
Fbolt=1/Ubolt(F0)
Flim=min(Fmember,Fglobal,Fbolt)
```

Отображаются N/kN/kgf; kgf нельзя подписывать как mass kg.

## 22. Static top payload

Gravity-only search сохраняет self weight и trial top mass:

```text
U_member(m)<=1
U_bolt(m)<=1
lambda_cr(m)>=1
```

Результат включает maximum total mass, remaining mass after configured load и equivalent water volume.

## 23. Verification

Internal evidence ladder сохраняет:

1. simple formulas;
2. equilibrium/residuals;
3. analytical known-answer problems;
4. independent numerical algorithms;
5. external FEM/expert review pending;
6. physical validation pending.

User-facing Worker result дополнительно включает modular topology/interface/global-vs-Schur checks.

External levels не могут автоматически становиться green от собственных unit tests приложения.

## 24. Reporting

UI, CSV и printable paper project читают already calculated result и не решают FEM повторно.

Paper project должен содержать:

- physical legs-down module topology;
- global FEM method;
- modular Schur formulas and cross-check residuals;
- module-by-module interface load table;
- maximum design/ultimate height;
- bottom module overload discriminator;
- connection checks;
- verification passport;
- limitations and Git SHA.

## 25. Internal snapshot

Schema prototype 1.1:

```text
mast-calculator/calculation-snapshot/v8
```

Обязательные новые данные:

```text
model.modules[]
member.moduleIndex / role
loadCase.analysis.modular
module interface actions
heightCapacity
modular diagnostics
```

JSON остаётся internal reproducibility artifact и не показывается отдельной пользовательской кнопкой.

## 26. Performance

Global K для одной geometry factorized один раз.

Modular solver выполняет малые 18×18 interface factorizations и не строит dense global inverse.

Height search не должен делать полный linear scan до search limit: требуется bracket/binary strategy.

Heavy calculation работает в Web Worker с progress/elapsed/ETA/cancel.

## 27. CI/CD

Required PR checks:

```text
npm test
npm run check
file line-limit guard
Linux/macOS/Windows tests
fresh-merge simulation
secret scan
static-site smoke
workflow policy tests
```

Static smoke обязан загружать:

```text
calculation-worker.js
viewer.js
module-viewer.js
engine/module-stack.js
engine/module-verification.js
solver/buckling/connection/report modules
```

## 28. Нормативная база

Current/future references:

- ГОСТ 34028-2016 — reinforcement;
- ГОСТ ISO 898-1-2014 — bolts/studs;
- ГОСТ 24705-2004 — metric thread;
- СП 16.13330.2017 — steel structures/connections;
- ГОСТ 5264-80 — manual arc welding;
- ГОСТ 9467-75 — electrodes;
- СП 20.13330.2016 — loads;
- ГОСТ 27751-2014 — reliability.

Упоминание документа не означает реализации всех его нормативных checks.

## 29. Открытые инженерные границы

Пока не реализованы:

- geometric nonlinearity / P-Delta;
- initial imperfections;
- plasticity;
- finite stiffness реального bolt/contact/weld joint;
- thread stripping and actual engagement length;
- bearing/prying/preload/slip;
- exact weld-group coordinates;
- fatigue;
- parameterized foundation;
- complete normative load combinations;
- independent external FEM validation of the real mast.

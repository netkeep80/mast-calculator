# Архитектура расчётного ядра

Документ фиксирует границы между изготовлением, погодными сценариями, геометрией, глобальным FEM-расчётом, отдельной боковой проверкой, будущим расчётом реальных узлов и бумажной отчётностью.

## 1. Поток данных

```text
Практический ввод
  stock length / parts / diameter / material / weather / loads
        │
        ├──────────────► Weather preset resolver
        │                 Beaufort/custom -> v -> q = rho*v²/2
        │
        ▼
Fabrication + Material catalogue
        │
        ├── a = Lstock / nparts
        ├── h = a*sqrt(2/3)
        └── E, nu, Ry, Rm, rho_steel
        │
        ▼
Regular-octahedron geometry
        │
        ├──────────────► Operational load cases
        │                 gravity / ice / wind / equipment
        │                        │
        │                        ▼
        │                 Global 3D frame FEM
        │                        │
        │                        ├── u / rotations
        │                        ├── reactions / moments
        │                        ├── member N/V/T/M
        │                        ├── stress / local Euler
        │                        └── eigen-buckling
        │
        └──────────────► Unit lateral tip-load cases
                          1 N horizontal, 0..120° sector
                                 │
                                 ▼
                          Global 3D frame FEM
                                 │
                                 ├── Fmember = 1/U(1 N)
                                 ├── Fglobal = lambda_cr*1 N
                                 └── Flim = min(...)

Operational envelope + lateral capacity
        │
        ├──────────────► UI / CSV
        ├──────────────► Printable calculation project
        └──────────────► Internal CalculationSnapshot v4
                           regression / cross-check only

Future:
Global frame FEM
        │
        ▼
Physical joint demand N/Vy/Vz/T/My/Mz
        │
        ▼
Bolt + thread + nut + weld-group checks
```

## 2. Fabrication model

Пользователь оперирует закупкой, а не абстрактной длиной КЭ-элемента.

```js
{
  stockBarLengthMm,
  stockBarPieces,
  barDiameterMm,
  reinforcementClass
}
```

Пока:

```text
ribCutLengthMm = stockBarLengthMm / stockBarPieces
```

Будущее расширение:

```js
{
  stockBarLengthMm,
  stockBarPieces,
  cutKerfMm,
  trimAllowanceMm,
  overlapAllowanceMm,
  usefulCutLengthMm,
  axialMemberLengthMm
}
```

Fabrication model не должна незаметно менять FEM geometry.

## 3. Material model

Материал выбирается идентификатором.

```js
{
  id: 'A500C',
  standard: 'ГОСТ 34028-2016',
  weldabilityGuaranteed: true,
  youngModulusGPa: 200,
  poissonRatio: 0.3,
  yieldStrengthMPa: 500,
  tensileStrengthMPa: 600,
  densityKgM3: 7850
}
```

Расчётные модули получают уже разрешённые свойства и не дублируют каталожные значения.

## 4. Weather model

`weather.js` отделяет пользовательское название погодного сценария от механической нагрузки.

```js
{
  windPresetId,
  windPresetLabel,
  beaufortForce,
  windSpeedMs,
  windPressurePa
}
```

Для Beaufort preset:

```text
q = rho_air*v²/2
rho_air = 1.225 kg/m³
```

После разрешения preset остальной solver работает с `windPressurePa` и не знает, каким способом оно было выбрано.

`custom` сохраняет ручной ввод давления.

Погодные preset не являются нормативным ветровым районированием; это UI-level сценарии для сравнения.

## 5. Geometry model

Для длины ребра `a` правильного октаэдра:

```text
R = a/sqrt(3)
h = a*sqrt(2/3)
```

Каждый уровень содержит три узла на окружности радиуса `R`. Соседние уровни повёрнуты на 60°.

Модуль содержит:

```text
3 horizontal edges
6 diagonal edges
= 9 edges
```

Все девять рёбер обязаны иметь одну длину `a`; это regression invariant.

Frame node:

```js
{
  id,
  position: [x, y, z],
  restrained: [ux, uy, uz, rx, ry, rz]
}
```

Нижние три узла полностью заделаны.

## 6. Frame element

На каждом конце:

```text
[ux, uy, uz, rx, ry, rz]
```

На элемент — 12 DOF.

Круглое сплошное сечение:

```text
A = pi*d²/4
Iy = Iz = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
G = E/[2*(1+nu)]
```

Euler–Bernoulli frame element использует:

```text
EA/L
GJ/L
12EI/L³
6EI/L²
4EI/L
2EI/L
```

Локальная матрица преобразуется:

```text
Ke = T^T * ke * T
```

Поворот всей консоли в глобальной системе не должен менять физический результат; это отдельный тест.

## 7. Distributed loads

`buildLoadCase` разделяет:

```js
nodalLoads[nodeId]                  // N
nodalMoments[nodeId]                // Nm, зарезервировано
memberDistributedLoads[memberId]   // N/m, global XYZ
```

Собственный вес, лёд и ветер — distributed member loads.

Для равномерной поперечной нагрузки consistent vector содержит силы `qL/2` и конечные моменты `qL²/12`.

Для цилиндрического элемента:

```text
qwind_vec = p * cd * dout * gamma_w * (ew - ex*(ex dot ew))
```

Ветер вдоль оси ребра даёт нулевую поперечную аэродинамическую нагрузку.

## 8. Global assembly and solution

Для каждого элемента:

```text
Ke -> global K
feq -> global F
```

После исключения restrained DOFs:

```text
Kfree * ufree = Ffree
```

Текущий прототип использует плотный solver с partial pivoting. При существенном росте числа DOF потребуется sparse solver.

Результат:

```js
{
  displacements,
  rotations,
  reactions,
  reactionMoments,
  memberResults,
  buckling,
  diagnostics
}
```

## 9. Member end actions and stresses

Локальный вектор конечных усилий:

```text
fend = ke * ue - feq
```

На концах он содержит:

```text
N, Vy, Vz, T, My, Mz
```

Напряжения:

```text
sigma_N = |N|/A
sigma_M = M/W
sigma = sigma_N + sigma_M

tau_T = T*(d/2)/J
tau_V = 4V/(3A)
tau = sqrt(tau_T² + tau_V²)

sigma_eq = sqrt(sigma² + 3*tau²)
```

Для равномерной поперечной нагрузки текущая версия консервативно добавляет:

```text
DeltaM = q_perp*L²/8
```

к максимуму конечных изгибающих моментов.

## 10. Local Euler check

```text
Leff = mu*L
N_E = pi²*E*I/Leff²/gamma_M
mu = 0.5
```

Итог:

```text
eta_member = max(eta_stress, eta_Euler)
```

## 11. Global eigen-buckling

После статического решения по продольным усилиям строится frame geometric stiffness:

```text
(K + lambda*KG) * phi = 0
```

Сохраняются `criticalLoadFactor`, translational/rotational mode и residuals.

Это линейная собственная задача, не nonlinear collapse analysis.

## 12. Lateral capacity pipeline

### 12.1. Отдельный normalized load case

`lateral-capacity.js` создаёт чистый испытательный случай:

```text
F0 = 1 N horizontal
```

Он распределяется поровну по top nodes. Отключаются:

```text
gravity
ice
wind
equipment
extra loads
```

Это делает результат воспроизводимым и пригодным для лабораторного/натурного сравнения.

### 12.2. Member limit

В линейной модели использование пропорционально силе:

```text
Fmember = 1 / eta_member(F0=1 N)
```

Тип member limit сохраняется как `material-strength` или `local-member-buckling`.

### 12.3. Global limit

Если единичная боковая сила создаёт физически значимое сжатие:

```text
Fglobal = lambda_cr(F0=1 N) * 1 N
```

Если максимальное сжатие меньше `1e-9 N`, `KG` считается вызванной только машинным шумом и global lateral buckling принимается бесконечным. Это требуется для чисто поперечной сплошной консоли, где осевое усилие теоретически равно нулю.

### 12.4. Governing limit

```text
Flim = min(Fmember, Fglobal)
```

Проверяется сектор 120° вращательной симметрии. Default step = 15°.

Результат хранит:

```js
{
  criticalForceN,
  criticalForceKgf,
  memberLimitForceN,
  globalBucklingForceN,
  governingMode,
  directionDeg,
  criticalMemberId,
  cases
}
```

`kgf` — только presentation unit:

```text
Fkgf = FN / 9.80665
```

## 13. Solid-rod validation model

Специальный sanity-check не является эксплуатационной геометрией. Он строится при:

```text
d_rib = a/2
D_mast = 2a/sqrt(3)
```

Сравнительная модель — сплошная круглая консоль:

```text
height = H_mast
diameter = D_mast
material = same
```

Площадь шести рёбер относительно solid rod:

```text
A6/Asolid = 9/8 = 1.125
```

CI сравнивает боковую предельную силу и линейную жёсткость. Цель — обнаружить ошибки порядка величин, единиц и топологии, а не заставить разные конструкции давать идентичные числа.

## 14. Physical joint demand — следующий слой

Global FEM не знает конкретный болт/шов. Контракт:

```js
{
  jointId,
  loadCaseId,
  action: { N, Vy, Vz, T, My, Mz }
}
```

Связанный набор `N/V/T/M` должен происходить из одного load case.

## 15. Joint definition — планируемая модель

```js
{
  id,
  type,
  thread: {
    nominalDiameterMm,
    pitchMm,
    boltPropertyClass,
    engagementLengthMm
  },
  welds: [{ type, lengthMm, legMm, position, direction }],
  welding: {
    process,
    consumableStandard,
    consumableGrade,
    consumableDiameterMm
  }
}
```

`jointCheck()` должен вернуть отдельные limit states и governing result.

## 16. Reporting contract

UI и CSV читают готовый solver/envelope. Они не решают FEM повторно.

Printable calculation project показывает:

```text
inputs
geometry derivation
section properties
weather q=rho*v²/2
load formulas
frame equations
critical member substitutions
Euler check
eigen-buckling
lateral Fmember/Fglobal/Flim
result tables
diagnostics
limitations
```

В бумажном документе нет JSON dump.

Internal `CalculationSnapshot v4` хранит:

```text
software/method/Git SHA
parameters + weather resolution
nodes/members/restraints
operational load cases
lateral capacity cases
member results
buckling
diagnostics
```

Он нужен для regression/cross-check и не экспортируется пользователю отдельной кнопкой.

## 17. Source-of-truth rule

Report renderer запрещено:

- повторно решать `K*u=F`;
- заново строить другую FEM-модель;
- подменять solver values;
- округлять значения до проверок.

Допускаются formatting, unit conversion, sorting и наглядные алгебраические подстановки из тех же параметров/results.

## 18. Numerical diagnostics

Каждый solve сохраняет:

```text
relativeResidual
minPivotRatio
maximumNodeEquilibriumResidual
globalMomentResidual
buckling residual
```

Результат с неудовлетворительной диагностикой не должен молча считаться надёжным.

## 19. Verification layers

### Analytical

- axial `FL/EA`;
- cantilever `PL³/(3EI)`;
- cantilever rotation `PL²/(2EI)`;
- fixed-fixed `qL/2`, `qL²/12`;
- lateral yield `P=Ryd*W/L`;
- analytical eigensystems;
- `q=rho*v²/2` and inverse conversion.

### Invariants

- force/moment equilibrium;
- equal octahedron edges;
- alternating geometry;
- coordinate-rotation invariance;
- complete Beaufort 0..12 and monotonic pressure;
- solid-rod area ratio `9/8`;
- solid-rod capacity/stiffness same-order sanity bands;
- UI/report contracts.

### Independent FEM cross-check

Reference models from a separate solver должны быть добавлены в отдельный validation directory с явными допусками.

## 20. CI as part of calculation architecture

Изменение расчётного ПО не считается безопасным, пока не прошли:

```text
syntax checks
CI policy tests
unit/analytical tests on Linux
unit/analytical tests on macOS
unit/analytical tests on Windows
secret scan
static-site smoke test
```

Подробности: [`CI_CD_REVIEW.md`](CI_CD_REVIEW.md).

Подробности боковой проверки и weather/solid-rod validation: [`LATERAL_CAPACITY_WEATHER_VALIDATION.md`](LATERAL_CAPACITY_WEATHER_VALIDATION.md).

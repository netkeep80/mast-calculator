# Архитектура расчётного ядра

Документ описывает архитектуру прототипа 0.7: практический ввод, геометрию, global 3D frame FEM, погодные и боковые сценарии, оптимизированный численный solver, отчётность и границу будущего расчёта физических узлов.

## 1. Поток данных

```text
Практический ввод
  stock / cutting / diameter / material / weather / loads
        │
        ▼
Fabrication + Material + Weather resolution
        │
        ├── a = Lstock/nparts
        ├── h = a*sqrt(2/3)
        ├── E, nu, Ry, Rm, rho
        └── weather preset -> v -> q
        │
        ▼
Regular-octahedron geometry
        │
        ▼
compileFrameSystem()
        │
        ├── element geometry/transforms
        ├── free DOF map
        ├── symmetric band K
        └── Cholesky(K) exactly once
        │
        ├──────────── operational wind cases
        │                 │
        │                 ├── build F
        │                 ├── band solve
        │                 ├── N/V/T/M
        │                 └── KG + generalized Lanczos
        │
        └──────────── lateral unit-load cases
                          │
                          ├── same K/factorization
                          ├── member limits
                          └── global buckling limits

Worker result
        │
        ├── UI / 3D viewer
        ├── CSV
        ├── printable calculation project
        └── internal CalculationSnapshot
```

Тяжёлая ветка от `calculateCompleteMast()` вниз выполняется в Web Worker. Main thread не решает FEM.

## 2. Fabrication model

Пользователь оперирует закупкой и раскроем:

```js
{
  stockBarLengthMm,
  stockBarPieces,
  barDiameterMm,
  reinforcementClass
}
```

До реализации kerf/trim/overlap:

```text
ribCutLengthMm = stockBarLengthMm/stockBarPieces
```

Будущая модель должна различать:

```text
stock length
physical cut length
trim allowance
joint overlap
useful member length
frame axis length
physical module height
```

## 3. Material model

Материал выбирается идентификатором и разрешается централизованным каталогом.

Пример:

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

Расчётные модули получают уже разрешённые свойства и не дублируют каталожные числа.

## 4. Weather model

`weather.js` отделяет пользовательский сценарий от механики:

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

Остальной solver работает только с `windPressurePa`.

Режим `custom` сохраняет ручной ввод давления.

Шкала Бофорта является сравнительным UI-сценарием и не заменяет нормативный wind design.

## 5. Geometry model

Для правильного октаэдра с ребром `a`:

```text
R = a/sqrt(3)
h = a*sqrt(2/3)
```

Каждый уровень содержит три узла на окружности радиуса `R`. Соседние уровни повернуты на 60°.

Один модуль:

```text
3 horizontal members
6 diagonal members
= 9 members
```

Все девять рёбер имеют одну длину `a`; это regression invariant.

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

На каждом узле:

```text
[ux, uy, uz, rx, ry, rz]
```

На элемент — 12 DOF.

Для круглого сплошного сечения:

```text
A = pi*d²/4
Iy = Iz = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
G = E/[2*(1+nu)]
```

Euler–Bernoulli local stiffness использует:

```text
EA/L
GJ/L
12EI/L³
6EI/L²
4EI/L
2EI/L
```

Переход в глобальную систему:

```text
Ke = T^T * ke * T
```

Локальный ортонормированный базис строится по оси стержня и устойчивому reference vector.

## 7. Distributed loads

`buildLoadCase()` разделяет:

```js
nodalLoads[nodeId]                // N
nodalMoments[nodeId]              // Nm
memberDistributedLoads[memberId] // N/m, global XYZ
```

Собственный вес, лёд и ветер — distributed loads.

Для равномерной поперечной нагрузки consistent nodal vector содержит:

```text
qL/2
qL²/12
```

то есть не только силы, но и эквивалентные конечные моменты.

Для цилиндрического member:

```text
qwind_vec = p*cd*dout*gamma_w*(ew - ex*(ex dot ew))
```

Ветер вдоль оси цилиндра не создаёт поперечной распределённой силы.

## 8. Почему глобальная K ленточная

Топология мачты локальна:

- horizontal member связывает узлы одного уровня;
- diagonal member связывает только два соседних уровня.

При последовательной нумерации уровней ненулевые блоки глобальной `K` расположены около главной диагонали.

После исключения закреплённых DOF текущая 40-модульная модель имеет:

```text
free DOF = 720
half-bandwidth = 35
```

Хранение и операции поэтому выполняются не как arbitrary dense matrix, а как symmetric band matrix.

## 9. Compile stage

`compileFrameSystem(model, parameters)` является границей между неизменной моделью и меняющимися load cases.

Он один раз вычисляет:

```text
member length
local axes
T
A, I, J, G
ke
Ke
free DOF list
global -> reduced DOF map
bandwidth
Kfree
Cholesky(Kfree)
total steel mass
```

Возвращаемый compiled system переиспользуется всеми направлениями одной геометрии.

Ключевой invariant:

```text
stiffnessFactorizationCount = 1
```

для одного полного расчёта.

## 10. Symmetric band Cholesky

Основной linear solver версии 0.7:

```text
symmetric-band-cholesky
```

Матрица хранит только нижнюю ленту шириной `b+1`.

Сложность хранения:

```text
O(n*b)
```

Сложность факторизации:

```text
O(n*b²)
```

Сложность одного forward/back solve после факторизации:

```text
O(n*b)
```

Это принципиально отличается от повторного dense `O(n³)` solve для каждого направления.

`banded.js` имеет отдельный cross-check против существующего dense reference solver.

## 11. Load-case static solve

Для каждого load case:

```text
assemble F
solve L*y = F
solve L^T*u = y
recover full displacement vector
recover member local end actions
recover reactions
```

То есть elastic `K` повторно не собирается и не факторизуется.

Результат содержит:

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

## 12. Member end actions and stresses

Локальный вектор конечных усилий:

```text
fend = ke*ue - feq
```

На концах:

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

Для равномерной поперечной нагрузки консервативно учитывается возможный внутренний максимум:

```text
DeltaM = q_perp*L²/8
```

## 13. Local Euler check

Для сжатого member:

```text
Leff = mu*L
N_E = pi²*E*I/Leff²/gamma_M
mu = 0.5
```

Итог:

```text
eta_member = max(eta_stress, eta_Euler)
```

Это упругая инженерная проверка, не полный нормативный member buckling design по СП 16.

## 14. Global eigen-buckling

После static solve из продольных усилий элементов собирается banded geometric stiffness `KG`.

Исходная задача:

```text
(K + lambda*KG)*phi = 0
```

Эквивалентная generalized eigen form:

```text
K^-1*(-KG)*phi = mu*phi
lambda = 1/mu
```

### 14.1. Почему нет явного K^-1

Версия 0.7 не строит inverse matrix.

Применение оператора к произвольному `v`:

```text
w = -KG*v
x = solve(K, w)
```

и возвращает `x`.

Elastic solve использует ту же заранее вычисленную Cholesky-factorization.

### 14.2. Generalized Lanczos

Operator является self-adjoint в `K`-inner product. Поэтому Krylov basis строится с нормированием:

```text
<x,y>_K = x^T*K*y
```

и повторной K-ортогонализацией.

Получается малая symmetric tridiagonal Ritz matrix. Её максимальное положительное eigenvalue даёт минимальный положительный `lambda`.

Сохраняются:

```text
criticalLoadFactor
mode
rotations
residual
eigenResidual
iterations
```

Малая generalized eigen-задача в tests сравнивает Lanczos с прежним dense reference.

## 15. Wind envelope и 120° symmetry

Треугольная идеальная модель имеет rotational period 120°.

Алгоритм не меняет заданную пользователем discretization:

1. строит прежнюю полную сетку `0..360`;
2. приводит каждый угол modulo 120°;
3. удаляет только совпадающие canonical angles;
4. считает оставшиеся уникальные FEM cases.

Для default 30°:

```text
12 full-circle samples -> 4 unique solves
```

Для 45°:

```text
8 full-circle samples -> 8 unique canonical angles
0,15,30,45,60,75,90,105
```

Это правило покрыто regression-тестом.

## 16. Lateral capacity pipeline

### 16.1. Normalized load case

Чистый проверочный случай:

```text
F0 = 1 N horizontal at top
```

Отключаются:

```text
gravity
ice
wind
equipment
extra loads
```

### 16.2. Member limit

```text
Fmember = 1/eta_member(F0=1 N)
```

Механизм:

```text
material-strength
local-member-buckling
```

### 16.3. Global limit

Если единичная боковая сила создаёт физически значимое сжатие:

```text
Fglobal = lambda_cr(F0=1 N)*1 N
```

Для чистой поперечной сплошной консоли microscopic axial numerical noise фильтруется; eigen-buckling там физически неприменим.

### 16.4. Governing limit

```text
Flim = min(Fmember, Fglobal)
```

Для `Fmember`, `Fglobal` и `Flim` сохраняются независимые direction envelopes.

Боковые cases используют тот же compiled elastic system, что и эксплуатационные cases.

## 17. Web Worker boundary

Browser architecture:

```text
Main thread
  form
  progress/ETA
  3D viewer
  report export
       │
       │ postMessage(parameters)
       ▼
calculation-worker.js
  calculateCompleteMast()
  selectUniformDiameter()
  FEM / buckling
       │
       │ progress/result/error messages
       ▼
Main thread
```

Main thread не импортирует и не вызывает FEM solve functions.

Отмена реализована жёстким прекращением отдельного вычислительного контекста:

```js
worker.terminate()
```

Это гарантирует немедленную отзывчивость cancel даже внутри длинной eigen-итерации.

## 18. Progress contract

Core API может получать callback `onProgress`.

Событие полного расчёта содержит:

```js
{
  phase,
  label,
  completed,
  total
}
```

Этапы:

```text
compile
wind
lateral
done
```

Worker превращает `completed/total` в `fraction` и отправляет main thread.

UI показывает:

```text
percent
stage label
detail
elapsed time
ETA
cancel
```

ETA:

```text
elapsed*(1-progress)/progress
```

является оценкой по завершённым крупным cases.

## 19. Diameter optimization

Подбор диаметра выполняется в Worker.

Для каждого standard diameter вызывается эксплуатационный `calculateMast()` с собственным compiled system, потому что изменение `d` меняет `A`, `I`, `J` и `K`.

После выбора минимального проходящего диаметра выполняется `calculateCompleteMast()` для итогового результата с lateral check.

Progress делится между diameter sweep и final complete solve.

## 20. Physical joint demand — следующий слой

Global FEM по-прежнему моделирует соединения идеальными.

Будущий интерфейс global FEM -> joint checks:

```js
{
  jointId,
  loadCaseId,
  action: { N, Vy, Vz, T, My, Mz }
}
```

Связанный набор `N/V/T/M` должен происходить из одного реального load case. Независимые экстремумы разных cases нельзя склеивать в несуществующий demand vector.

## 21. Planned joint definition

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
  welds: [
    { type, lengthMm, legMm, position, direction }
  ],
  welding: {
    process,
    consumableStandard,
    consumableGrade,
    consumableDiameterMm
  }
}
```

Будущий `jointCheck()` должен возвращать отдельные limit states и governing result.

## 22. Reporting contract

UI, CSV и printable project читают уже вычисленные solver results.

Report renderer запрещено:

- повторно решать `K*u=F`;
- собирать альтернативную FEM-модель;
- подменять solver values;
- округлять значения до инженерных проверок.

Допускаются:

- formatting;
- unit conversion;
- sorting;
- алгебраические подстановки из тех же parameters/results.

## 23. Internal CalculationSnapshot

Internal snapshot v4 хранит:

```text
software/method/Git SHA
parameters + weather
nodes/members/restraints
operational load cases
lateral cases
member results
buckling
diagnostics
```

Это regression/debug format, не пользовательский бумажный документ.

## 24. Numerical diagnostics

Каждый solve сохраняет:

```text
relativeResidual
minPivotRatio
freeDofCount
stiffnessBandwidth
stiffnessFactorizationCount
maximumNodeEquilibriumResidual
globalMomentResidual
buckling residual
buckling eigenResidual
buckling iterations
```

Плохая диагностика не должна молча отображаться как надёжный engineering result.

## 25. Verification layers

### Analytical

- axial `FL/EA`;
- cantilever `PL³/(3EI)`;
- cantilever rotation `PL²/(2EI)`;
- fixed-fixed `qL/2`, `qL²/12`;
- lateral von Mises limit;
- analytical/dense eigensystems.

### Numerical cross-check inside repo

- banded Cholesky vs dense solve;
- generalized Lanczos vs dense generalized buckling reference.

### Structural invariants

- force equilibrium;
- moment equilibrium;
- regular-octahedron equal edges;
- alternating geometry;
- coordinate rotation invariance;
- complete Beaufort scale;
- solid-rod sanity bands;
- one K factorization per complete calculation;
- exact symmetry reduction of full wind grid.

### Performance regression

40 modules:

```text
free DOF = 720
bandwidth = 35
factorizations = 1
wind cases = 4
lateral cases = 8
```

GitHub-hosted Ubuntu measurement on 2026-08-07:

```text
860.9 ms
```

CI guard is intentionally much looser than this measurement to avoid flaky hardware-dependent failures while still detecting a return to minute-scale dense behavior.

### Independent FEM cross-check

External solver reference models are still required before treating the program as a final engineering design tool.

## 26. CI as part of calculation architecture

Calculation changes are not considered complete until passing:

```text
syntax checks
file-size/maintainability guard
CI policy tests
unit + analytical + performance tests on Linux
same tests on macOS
same tests on Windows
secret scan
static-site smoke test
```

Static smoke includes:

```text
app.js
calculation-worker.js
solver.js
banded.js
buckling.js
weather.js
lateral-capacity.js
report modules
styles.css
```

Подробности производительности: [`PERFORMANCE_AND_PROGRESS.md`](PERFORMANCE_AND_PROGRESS.md).

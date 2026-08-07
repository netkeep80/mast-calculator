# Архитектура расчётного ядра

Документ фиксирует архитектуру прототипа 0.7: границы между пользовательским вводом, геометрией, global 3D frame FEM, оптимизированным численным solver, Web Worker, отчётностью и будущим расчётом физических соединений.

## 1. Общий поток

```text
Практический ввод
  stock / cutting / diameter / material / weather / loads
        │
        ▼
Parameter resolution
  a = Lstock/nparts
  h = a*sqrt(2/3)
  material catalogue
  weather preset -> v -> q
        │
        ▼
Regular-octahedron geometry
        │
        ▼
compileFrameSystem()
  element geometry + transforms
  free DOF map
  symmetric band K
  Cholesky(K) once
        │
        ├──────────── operational wind cases
        │               build F -> solve -> N/V/T/M -> KG -> buckling
        │
        └──────────── lateral unit-load cases
                        same K -> solve -> member/global limits
        │
        ▼
Worker result
        ├── UI / viewer
        ├── CSV
        ├── printable project
        └── internal snapshot
```

Main thread браузера не выполняет FEM.

## 2. Fabrication и material model

Пользователь задаёт:

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
ribCutLengthMm = stockBarLengthMm/stockBarPieces
```

Каталог материала централизованно задаёт:

```text
E
nu
Ry
Rm
rho
weldability
standard
```

Будущая fabrication model должна отдельно учитывать kerf, trim, overlap и физическую геометрию соединительного узла.

## 3. Weather model

`weather.js` разрешает UI-сценарий в механические параметры:

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

Остальной solver работает с `windPressurePa` и не зависит от способа его выбора.

## 4. Geometry

Для правильного октаэдра:

```text
R = a/sqrt(3)
h = a*sqrt(2/3)
```

Каждый уровень содержит три узла. Соседние уровни повёрнуты на 60°.

Один модуль:

```text
3 horizontal members
6 diagonal members
= 9 members
```

Frame node:

```js
{
  id,
  position: [x, y, z],
  restrained: [ux, uy, uz, rx, ry, rz]
}
```

Нижние три узла полностью заделаны.

## 5. Frame element

На узел:

```text
[ux, uy, uz, rx, ry, rz]
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

Euler–Bernoulli local stiffness использует:

```text
EA/L
GJ/L
12EI/L³
6EI/L²
4EI/L
2EI/L
```

Переход в global coordinates:

```text
Ke = T^T*ke*T
```

## 6. Distributed loads

`buildLoadCase()` разделяет:

```js
nodalLoads[nodeId]
nodalMoments[nodeId]
memberDistributedLoads[memberId]
```

Собственный вес, лёд и ветер являются distributed member loads.

Для равномерной поперечной нагрузки consistent load vector содержит `qL/2` и `qL²/12`.

Ветровая нагрузка цилиндрического member:

```text
qwind = p*cd*dout*gamma_w*(ew - ex*(ex dot ew))
```

Компонента вдоль оси цилиндра исключается.

## 7. Почему K ленточная

Member связывает узлы одного уровня либо двух соседних уровней. При последовательной нумерации уровней ненулевые коэффициенты глобальной `K` находятся около главной диагонали.

Для 40 модулей:

```text
123 nodes
738 total DOF
720 free DOF
half-bandwidth = 35
```

Поэтому основной solver использует symmetric band storage вместо `n×n` dense matrix.

## 8. compileFrameSystem

`compileFrameSystem(model, parameters)` отделяет неизменную механику модели от меняющихся load cases.

Один раз вычисляются:

```text
member lengths
local axes
T
A, I, J, G
ke / Ke
free DOF map
bandwidth
Kfree
Cholesky(Kfree)
total mass
```

Ключевой invariant полного расчёта одной геометрии:

```text
stiffnessFactorizationCount = 1
```

## 9. Symmetric band Cholesky

Основной linear-system solver:

```text
symmetric-band-cholesky
```

Сложности:

```text
storage       O(n*b)
factorization O(n*b²)
solve         O(n*b)
```

После factorization каждый новый load case требует только assembly RHS и forward/back substitution.

`tests/banded.test.js` сравнивает banded solve с существующим dense reference.

## 10. Static load case

Для каждого case:

```text
assemble F
solve K*u = F
recover member local end actions
recover reactions
build KG from axial forces
solve generalized buckling
```

Member end vector:

```text
fend = ke*ue - feq
```

содержит:

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

Для distributed transverse load дополнительно учитывается внутренний максимум порядка `q_perp*L²/8`.

## 11. Local Euler check

```text
Leff = mu*L
N_E = pi²*E*I/Leff²/gamma_M
mu = 0.5
eta_member = max(eta_stress, eta_Euler)
```

Это текущая упругая инженерная проверка, а не полный нормативный member buckling design.

## 12. Global buckling

Исходная задача:

```text
(K + lambda*KG)*phi = 0
```

Эквивалентный operator:

```text
A(v) = solve(K, -KG*v)
mu = eigenvalue(A)
lambda = 1/mu
```

Явный `K^-1` не строится.

Generalized Lanczos работает в `K`-inner product:

```text
<x,y>_K = x^T*K*y
```

и использует повторную K-ортогонализацию.

Критерий остановки — фактическая невязка исходной задачи:

```text
r = (K + lambda*KG)*phi
```

а не только внутренняя Ritz-оценка.

Сохраняются:

```text
criticalLoadFactor
mode
rotations
residual
eigenResidual
iterations
```

`tests/buckling.test.js` сравнивает fast generalized Lanczos с dense reference на малой задаче.

## 13. Wind envelope и 120° symmetry

Треугольная идеальная модель имеет rotational period 120°.

Алгоритм:

1. строит прежнюю полную пользовательскую сетку `0..360`;
2. приводит углы modulo 120°;
3. удаляет только совпадающие canonical angles;
4. считает уникальные cases.

Default step 30°:

```text
12 full-circle samples -> 4 solves
0, 30, 60, 90 degrees
```

Step 45°:

```text
0, 15, 30, 45, 60, 75, 90, 105
```

Таким образом optimization не теряет направления исходной discretization.

## 14. Lateral capacity

Проверочный normalized case:

```text
F0 = 1 N horizontal at top
```

В нём отключаются gravity, wind, ice, equipment и extra loads.

Из линейности:

```text
Fmember = 1/eta_member(F0)
Fglobal = lambda_cr(F0)*1 N
Flim = min(Fmember, Fglobal)
```

`Fmember`, `Fglobal` и `Flim` имеют независимые direction envelopes.

Lateral cases используют тот же compiled elastic system, что и эксплуатационные cases.

## 15. Web Worker

Browser boundary:

```text
Main thread                     Worker
-----------                     ------
form                            calculateCompleteMast
progress UI       <----------   progress messages
3D viewer         <----------   result/error
report export                   selectUniformDiameter
```

Main thread не импортирует FEM solve API.

Cancel:

```js
worker.terminate()
```

поэтому остановка не зависит от точки, в которой находится eigen-итерация.

## 16. Progress contract

Core callback:

```js
{
  phase,
  label,
  completed,
  total
}
```

Phases:

```text
compile
wind
lateral
done
```

Worker преобразует это в `fraction`. UI показывает percent, stage, detail, elapsed, ETA и cancel.

ETA оценивается как:

```text
elapsed*(1-progress)/progress
```

Это estimate по крупным завершённым cases, а не гарантированное время.

## 17. Diameter optimization

Диаметры сортируются по возрастанию.

Первый candidate, который проходит одновременно:

```text
strength
displacement
global buckling
```

является минимальным искомым, поэтому более крупные diameters по умолчанию не рассчитываются.

Reference/debug mode `stopAtFirstPassing: false` позволяет просчитать весь список.

После выбора выполняется полный final calculation, включая lateral capacity.

## 18. Reporting boundary

UI, CSV и printable project читают уже рассчитанные results.

Report renderer не должен:

- повторно решать FEM;
- создавать альтернативную механическую модель;
- менять solver values;
- округлять числа до проверок.

Internal `CalculationSnapshot v4` предназначен для regression/debug, не для бумажного отчёта.

## 19. Physical joint boundary

Global FEM по-прежнему считает соединения идеальными и жёсткими.

Будущий joint layer получает связанный demand одного load case:

```js
{
  jointId,
  loadCaseId,
  action: { N, Vy, Vz, T, My, Mz }
}
```

Нельзя комбинировать независимые максимумы разных cases в физически несуществующий vector.

## 20. Diagnostics

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

Плохая диагностика должна приводить к warning, а не молча считаться надёжным результатом.

## 21. Verification

Analytical/reference tests:

- axial `FL/EA`;
- cantilever `PL³/(3EI)`;
- rotation `PL²/(2EI)`;
- fixed-fixed `qL/2`, `qL²/12`;
- lateral von Mises limit;
- banded solve vs dense;
- generalized Lanczos vs dense.

Structural invariants:

- force/moment equilibrium;
- equal octahedron edges;
- alternating geometry;
- coordinate rotation invariance;
- Beaufort 0..12;
- solid-rod sanity bands;
- exact symmetry reduction;
- one K factorization per complete geometry.

## 22. 40-module performance regression

Обязательный CI case:

```text
modules = 40
free DOF = 720
bandwidth <= 35
factorizations = 1
wind cases = 4
lateral cases = 8
static residual < 1e-8
node equilibrium residual < 1e-8
buckling residual < 1e-5
```

Финальное GitHub-hosted Ubuntu измерение 2026-08-07:

```text
1078.3 ms
```

CI performance guard = 20 s, чтобы избежать hardware-dependent flaky tests и при этом ловить возврат к minute-scale dense behavior.

## 23. Независимая инженерная верификация

Внутренние analytical/dense cross-checks не заменяют внешний FEM cross-check.

До использования как окончательного design tool необходимы reference models независимого КЭ-комплекса с допусками по:

```text
displacements
reactions
N/V/T/M
stresses
buckling eigenvalues/modes
```

## 24. CI

Расчётное изменение считается завершённым только после:

```text
syntax + maintainability
CI policy tests
Linux tests
macOS tests
Windows tests
secret scan
static-site smoke
```

Static smoke проверяет выдачу `app.js`, `calculation-worker.js`, `solver.js`, `banded.js`, `buckling.js`, weather/lateral/report modules и CSS.

Подробный performance design: [`PERFORMANCE_AND_PROGRESS.md`](PERFORMANCE_AND_PROGRESS.md).

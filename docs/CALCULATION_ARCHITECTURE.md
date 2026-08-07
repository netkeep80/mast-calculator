# Архитектура расчётного ядра

Статус: архитектура прототипа 0.9.

Документ фиксирует границы между практическим вводом, геометрией, global 3D frame FEM, оптимизированным solver, специальными предельными cases, многоуровневой верификацией, Web Worker и отчётностью.

## 1. Общий поток

```text
Practical input
  stock / cutting / diameter / material / weather / loads
        |
        v
Parameter resolution
  a = Lstock/nparts
  h = a*sqrt(2/3)
  material catalogue
  weather preset -> v -> q
        |
        v
Regular-octahedron geometry
        |
        v
compileFrameSystem()
  element geometry + transforms
  free DOF map
  symmetric band K
  Cholesky(K) once
        |
        +---- operational wind cases
        |       build F -> solve -> N/V/T/M -> KG -> buckling
        |
        +---- lateral unit-load cases
        |       same K -> solve -> member/global limits
        |
        +---- static top-payload search
        |       same K -> self weight + trial mass -> solve/buckling
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
        +-- CSV
        +-- printable project + verification appendix
        +-- internal CalculationSnapshot v6
```

Main thread браузера не выполняет FEM solve.

## 2. Parameter/material boundary

Пользовательские fabrication inputs:

```js
{
  stockBarLengthMm,
  stockBarPieces,
  barDiameterMm,
  reinforcementClass
}
```

До отдельной fabrication model:

```text
ribCutLengthMm = stockBarLengthMm/stockBarPieces
```

Material catalogue централизованно задаёт:

```text
E
nu
Ry
Rm
rho
weldability
standard
```

`resolveCalculationParameters()` всегда заново выводит `ribCutLengthMm`, `triangleSideMm`, `moduleHeightMm` и фиксирует `effectiveLengthFactor=0.5` для текущей fixed-fixed идеализации.

## 3. Weather boundary

`weather.js` разрешает UI selection в:

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

Mechanical solver получает уже `windPressurePa` и не зависит от способа выбора погоды.

## 4. Geometry

Для правильного октаэдра:

```text
R = a/sqrt(3)
h = a*sqrt(2/3)
```

Каждый уровень содержит три узла; соседние уровни повёрнуты на 60°.

Один module:

```text
3 horizontal members
6 diagonal members
= 9 members
```

Node:

```js
{
  id,
  position: [x, y, z],
  restrained: [ux, uy, uz, rx, ry, rz]
}
```

Нижние три nodes полностью заделаны.

## 5. Frame element

На node:

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

Coordinate transform:

```text
Ke = T^T*ke*T
```

Идеальные joints не имеют moment releases.

## 6. Loads

`buildLoadCase()` разделяет:

```js
nodalLoads[nodeId]
nodalMoments[nodeId]
memberDistributedLoads[memberId]
```

Self weight, ice and member wind являются distributed loads.

Для uniform transverse load consistent local vector учитывает `qL/2` и `qL²/12`.

Wind vector цилиндрического member:

```text
qwind = p*cd*dout*gamma_w*(ew - ex*(ex dot ew))
```

Осевая компонента потока исключается.

## 7. Symmetric band K

Текущая топология соединяет nodes одного либо двух соседних уровней. При level-order numbering глобальная stiffness matrix имеет ограниченную полуширину.

40 modules:

```text
123 nodes
738 total DOF
720 free DOF
half-bandwidth = 35
```

Основной solver использует symmetric band storage:

```text
storage       O(n*b)
factorization O(n*b²)
solve         O(n*b)
```

## 8. compileFrameSystem

Один раз на геометрию рассчитываются:

```text
member length/local axes
T
A/I/J/G
ke/Ke
free DOF map
bandwidth
Kfree
Cholesky(Kfree)
total mass
```

Invariant complete calculation:

```text
stiffnessFactorizationCount = 1
```

Все subsequent load cases переиспользуют factorization.

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

Member local end vector:

```text
fend = ke*ue - feq
```

содержит `N, Vy, Vz, T, My, Mz`.

Stress recovery:

```text
sigma_N = |N|/A
sigma_M = M/W
sigma = sigma_N + sigma_M

tau_T = T*(d/2)/J
tau_V = 4V/(3A)
tau = sqrt(tau_T² + tau_V²)

sigma_eq = sqrt(sigma² + 3*tau²)
```

Для transverse distributed load дополнительно учитывается internal bending allowance порядка `q_perp*L²/8`.

## 10. Local Euler check

```text
Leff = mu*L
mu = 0.5
N_E = pi²*E*I/Leff²/gamma_M
eta_member = max(eta_stress, eta_Euler)
```

Это текущая elastic engineering check, не полный СП 16 member design.

## 11. Global buckling

Исходная задача:

```text
(K + lambda*KG)*phi = 0
```

Рабочий matrix-free operator:

```text
A(v) = solve(K, -KG*v)
mu = eigenvalue(A)
lambda = 1/mu
```

Явный `K^-1` не строится.

Generalized Lanczos работает в `K`-inner product и использует повторную ортогонализацию.

Критерий сходимости обязательно включает actual generalized residual:

```text
r = (K + lambda*KG)*phi
```

Сохраняются `criticalLoadFactor`, mode translations/rotations, residual/eigenResidual and iterations.

## 12. Wind envelope и 120° symmetry

Полная пользовательская сетка `0..360` сначала строится без изменений, затем canonical angles сворачиваются modulo 120° и удаляются только точные физически эквивалентные duplicates.

Default 30°:

```text
12 full-circle samples -> 4 solves
0, 30, 60, 90 degrees
```

Optimization не имеет права терять уникальное направление исходной сетки.

## 13. Lateral capacity

Normalized special case:

```text
F0 = 1 N horizontal at top
```

В нём отключены gravity, wind, ice, equipment and extra loads.

Из линейности:

```text
Fmember = 1/eta_member(F0)
Fglobal = lambda_cr(F0)*1 N
Flim = min(Fmember, Fglobal)
```

`Fmember`, `Fglobal`, `Flim` строят independent direction envelopes.

## 14. Static top payload capacity

Этот special case, наоборот, сохраняет self weight и прикладывает trial mass вертикально к top nodes.

Для каждого `m`:

```text
Pdesign = m*g*equipmentLoadFactor
U_member(m)
lambda_cr(m)
```

Pass condition:

```text
U_member <= 1
lambda_cr >= 1
```

Pure 1 kg case без self weight используется только для initial upper bound. Финальное значение уточняется binary search уже с self weight.

Все trial cases используют то же `K` и его единственную Cholesky factorization.

## 15. Verification layer

`site/engine/verification.js` не является ещё одним FEM solver. Он читает готовый complete result и формирует **evidence passport**.

```text
result
  -> buildVerificationPassport(result)
       -> level 1: simple independent formulas
       -> level 2: equilibrium + residuals
       -> level 3: known-answer production-solver benchmarks
       -> level 4: different numerical algorithms/reference
       -> level 5: external FEM + expert review = pending
       -> level 6: physical validation = pending
```

### 15.1. Level 1 — derived inputs and easy quantities

Проверяются независимо от UI display:

```text
a = L0/n
h = a*sqrt(2/3)
actual H from node coordinates
member count
actual member lengths
steel mass from Lsum*A*rho
self weight from m*g*gamma_g
wind pressure from rho_air*v²/2
```

Для numeric checks сохраняются:

```js
{
  actual,
  expected,
  tolerance,
  relativeError,
  formula,
  substitution,
  howToCheck
}
```

### 15.2. Level 2 — equation/physics closure

Паспорт агрегирует worst-case diagnostics по operational cases:

```text
global force closure
moment closure
linear residual
free DOF equilibrium residual
buckling residual
```

Эти проверки отвечают на вопрос «удовлетворяет ли найденное решение собранной задаче и законам равновесия?», но не на вопрос «правильно ли сформулирована реальная задача?».

### 15.3. Level 3 — runtime known-answer frame checks

При `calculateCompleteMast()` тем же production `analyzeFrame()` решаются небольшие модели:

```text
axial bar:        delta = FL/(EA)
cantilever:       delta = PL³/(3EI)
cantilever angle: theta = PL²/(2EI)
```

Это self-test именно production frame element, а не копия формулы из report renderer.

### 15.4. Level 4 — cross-algorithm checks

Рабочий banded Cholesky сравнивается с отдельным dense Gaussian solver на одной SPD system.

Рабочий banded/Lanczos buckling и dense reference решают diagonal generalized eigenproblem с analytical `lambda_cr=2`.

Purpose: ловить ошибки fast numerical path, не выдавая cross-algorithm agreement за proof полной physical model.

### 15.5. Levels 5–6 are intentionally pending

Программный код не может сам сделать независимыми собственные результаты. Поэтому следующие checks создаются с status `not-verified`:

```text
external FEM
expert engineering review
physical validation
```

UI и paper report обязаны показывать это явно.

### 15.6. Passport status

Если есть любой internal fail:

```text
verification.status = failed
```

Если levels 1–4 pass, а внешние остаются pending:

```text
verification.status = internal-passed-external-pending
```

Это означает internal verification, а не validation реальной конструкции.

Подробности: [`VERIFICATION_FOR_NON_SPECIALISTS.md`](VERIFICATION_FOR_NON_SPECIALISTS.md).

## 16. Verification anti-false-green

`tests/verification.test.js` содержит negative regression: рассчитанная total steel mass намеренно меняется на 5%, passport перестраивается, и `steel-mass` обязан стать `fail`.

Таким образом CI проверяет не только happy path, но и способность verification layer обнаруживать controlled inconsistency.

## 17. Web Worker boundary

```text
Main thread                     Worker
-----------                     ------
form                            calculateCompleteMast
progress UI       <----------   progress messages
3D viewer         <----------   result/error
paper/CSV export                selectUniformDiameter
```

Main thread не импортирует FEM solve API.

Cancel:

```js
worker.terminate()
```

## 18. Progress contract

Core callback:

```js
{
  phase,
  label,
  completed,
  total
}
```

Major phases:

```text
compile
wind
lateral
static-payload
done
```

Verification analytical/reference micro-checks выполняются после основных cases; их стоимость мала относительно полного FEM search и они не изменяют `K` мачты.

## 19. Diameter optimization

Standard diameters проверяются по возрастанию. Первый candidate, проходящий по strength/displacement/global buckling, является минимальным искомым. После выбора выполняется complete calculation, который добавляет lateral capacity, static payload и verification passport.

## 20. Reporting boundary

UI, CSV and printable project читают уже рассчитанные results.

Report renderer не должен:

- повторно решать FEM;
- создавать альтернативную mechanical model;
- менять solver values;
- использовать отдельные скрытые формулы для определения результата.

Paper project добавляет verification appendix из того же `result.verification`.

Internal snapshot:

```text
mast-calculator/calculation-snapshot/v6
```

и включает full verification evidence. JSON остаётся internal regression/debug artifact.

## 21. Physical joint boundary

Global FEM продолжает считать joints ideal rigid.

Будущий joint layer получает correlated demand одного load case:

```js
{
  jointId,
  loadCaseId,
  action: { N, Vy, Vz, T, My, Mz }
}
```

Нельзя смешивать maxima разных load cases в физически несуществующий vector.

## 22. Diagnostics

Каждый solve сохраняет минимум:

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

Плохая диагностика должна приводить к warning/verification fail, а не молча считаться надёжным результатом.

## 23. Verification pyramid

Автоматизированные evidence layers:

```text
analytical formulas
physical equilibrium
known-answer production-solver cases
fast-vs-reference algorithms
structural invariants/regressions
40-module performance/residual regression
```

Внешние layers, которые остаются вне самого приложения:

```text
independent FEM cross-check
engineering review
physical validation
```

Это разграничение является архитектурным требованием, а не только текстом документации.

## 24. 40-module regression

Обязательный CI case:

```text
modules = 40
free DOF = 720
bandwidth <= 35
factorizations = 1
wind cases = 4
lateral cases = 8
static payload evaluations = fixed bounded count
static residual < 1e-8
node equilibrium residual < 1e-8
buckling residual < 1e-5
verification.failed = 0
verification levels 1..4 = PASS
runtime < generous CI guard
```

Performance guard предназначен для обнаружения возврата к minute-scale dense behavior, а не для гарантии конкретного времени на любом компьютере.

## 25. Independent engineering verification

Внутренние analytical/reference checks не заменяют external FEM cross-check.

Для external verification должны быть сохранены reference models с одинаковыми:

```text
coordinates/topology
restraints/releases
E/nu/A/I/J
loads and units
```

и сравнены:

```text
displacements/rotations
reactions/moments
N/V/T/M
stresses
buckling eigenvalues/modes
```

Engineering review постановки является отдельным evidence item.

## 26. CI completion rule

Расчётное изменение считается готовым только после:

```text
syntax + maintainability
CI policy tests
Linux tests
macOS tests
Windows tests
secret scan
static-site smoke
```

Static smoke обязан проверять выдачу `verification.js` вместе с Worker, solver, banded/buckling, weather/lateral/static-payload/report modules и CSS.

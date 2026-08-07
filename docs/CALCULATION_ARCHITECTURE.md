# Архитектура расчётного ядра

Документ фиксирует границы между изготовлением, геометрией, глобальным FEM-расчётом, будущим расчётом реальных узлов и бумажной отчётностью.

## 1. Поток данных

```text
Практический ввод
  stock length / parts / diameter / material / loads
        │
        ▼
Fabrication + Material catalogue
        │
        ├── a = Lstock / nparts
        ├── h = a*sqrt(2/3)
        └── E, nu, Ry, Rm, rho
        │
        ▼
Regular-octahedron geometry
        │
        ▼
Global 3D frame FEM
  rigid ideal welded joints
        │
        ├── displacements / rotations
        ├── reactions / reaction moments
        ├── member N/V/T/M
        ├── stresses / local Euler check
        └── global eigen-buckling
        │
        ├──────────────► UI / CSV
        │
        ├──────────────► Printable calculation project
        │
        └──────────────► Internal CalculationSnapshot
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

Расчётные модули получают уже разрешённые свойства и не должны дублировать каталожные значения.

## 4. Geometry model

### 4.1. Regular octahedron

Для длины ребра `a`:

```text
R = a/sqrt(3)
h = a*sqrt(2/3)
```

Каждый уровень содержит три узла на окружности радиуса `R`.

Уровни чередуются по углу:

```text
0°, +60°, 0°, +60°, ...
```

или эквивалентно соседний переход геометрически зеркален предыдущему.

Каждый модуль содержит:

```text
3 horizontal edges
6 diagonal edges
= 9 edges
```

Все девять рёбер правильного октаэдра обязаны иметь одну длину `a`; это regression invariant.

### 4.2. Nodes

Frame node:

```js
{
  id,
  position: [x, y, z],
  restrained: [ux, uy, uz, rx, ry, rz]
}
```

В версии 0.5 нижние три узла полностью заделаны.

## 5. Frame element

### 5.1. Degrees of freedom

На каждом конце элемента:

```text
[ux, uy, uz, rx, ry, rz]
```

На элемент — 12 DOF.

### 5.2. Section properties

Круглое сплошное сечение:

```text
A = pi*d²/4
Iy = Iz = pi*d⁴/64
J = pi*d⁴/32
G = E/[2*(1+nu)]
```

### 5.3. Local stiffness

Euler–Bernoulli frame element использует коэффициенты:

```text
EA/L
GJ/L
12EI/L³
6EI/L²
4EI/L
2EI/L
```

Локальная 12×12 матрица `ke` строится в ортонормированном локальном базисе элемента.

### 5.4. Coordinate transformation

```text
Ke = T^T * ke * T
```

Локальные оси выбираются из направления элемента и устойчивого reference vector. Аналитический тест проверяет, что поворот всей консоли в глобальной системе не меняет физический результат.

## 6. Distributed loads

`buildLoadCase` разделяет:

```js
nodalLoads[nodeId]                  // N
nodalMoments[nodeId]                // Nm, зарезервировано
memberDistributedLoads[memberId]   // N/m, global XYZ
```

Собственный вес, лёд и ветер являются распределёнными нагрузками элемента.

### 6.1. Consistent nodal load vector

Равномерная локальная нагрузка преобразуется в 12-компонентный consistent load vector. Для поперечных компонент возникают не только силы `qL/2`, но и конечные моменты `qL²/12`.

Это принципиальное отличие от старой truss-модели.

### 6.2. Wind projection

Для цилиндрического элемента:

```text
qwind_vec = p * cd * dout * gamma_w * (ew - ex*(ex dot ew))
```

Ветер, направленный вдоль оси ребра, даёт нулевую распределённую аэродинамическую силу.

## 7. Global assembly and solution

Для каждого элемента:

```text
Ke -> global K
feq -> global F
```

После сборки и исключения restrained DOFs:

```text
Kfree * ufree = Ffree
```

Текущий prototype использует плотный решатель с partial pivoting. Для размеров рассматриваемой мачты это допустимо; при существенном росте числа DOF потребуется sparse solver.

Результат:

```js
{
  displacements,
  rotations,
  reactions,
  reactionMoments,
  memberResults,
  diagnostics
}
```

## 8. Member end actions and stresses

Локальный вектор конечных усилий:

```text
fend = ke * ue - feq
```

Он содержит на двух концах:

```text
N, Vy, Vz, T, My, Mz
```

Из него рассчитываются:

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

к максимуму конечных изгибающих моментов, чтобы не потерять возможный внутренний максимум одноэлементной балки.

## 9. Local Euler check

Отдельно от frame stress check:

```text
Leff = mu*L
N_E = pi²*E*I/Leff²/gamma_M
```

В версии 0.5:

```text
mu = 0.5
```

из-за идеализации двух жёстко заделанных концов.

Итог:

```text
eta_member = max(eta_stress, eta_Euler)
```

## 10. Global eigen-buckling

После статического решения по продольным усилиям строится initial-stress/geometric stiffness matrix frame-elements.

```text
(K + lambda*KG) * phi = 0
```

Сохраняются:

- `criticalLoadFactor`;
- translational mode;
- rotational mode;
- residual/eigenResidual;
- iterations.

Это линейная собственная задача, а не nonlinear collapse analysis.

## 11. Physical joint demand — следующий слой

Глобальный FEM не знает, какой конкретно болт или сварной шов реализует идеальный узел.

Интерфейс global FEM → joint check:

```js
{
  jointId,
  loadCaseId,
  action: {
    N,
    Vy,
    Vz,
    T,
    My,
    Mz
  }
}
```

Критическое правило: связанный набор `N/V/T/M` должен происходить из одного load case. Нельзя комбинировать независимые максимумы из разных случаев и выдавать их за реально существующий vector demand.

## 12. Joint definition — планируемая модель

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
    {
      type,
      lengthMm,
      legMm,
      position,
      direction
    }
  ],
  welding: {
    process,
    consumableStandard,
    consumableGrade,
    consumableDiameterMm
  }
}
```

`jointCheck()` должен вернуть отдельные limit states и governing result.

## 13. Reporting contract

### 13.1. Screen and CSV

UI и CSV читают готовые результаты solver/envelope. Они не решают FEM повторно.

### 13.2. Printable calculation project

Пользовательский отчёт — человекочитаемый инженерный документ:

```text
inputs
geometry derivation
section-property formulas
load formulas
frame FEM equations
critical member substitutions
Euler check
eigen-buckling
result tables
diagnostics
limitations
```

В бумажном документе **нет JSON dump**.

### 13.3. Internal CalculationSnapshot

Для regression/cross-check допускается внутренний snapshot:

```text
software/method/Git SHA
parameters
nodes/members/restraints
loadCases
member results
buckling
diagnostics
```

Он не является пользовательским отчётом и не экспортируется отдельной кнопкой.

## 14. Reporting source-of-truth rule

Report renderer запрещено:

- повторно решать `K*u=F`;
- заново вычислять member forces из другой модели;
- подменять solver values вручную введёнными числами;
- округлять значения до того, как они попали в проверки.

Разрешено:

- вычислять наглядные алгебраические подстановки из тех же исходных параметров;
- форматировать единицы;
- округлять только отображаемое значение;
- сортировать таблицы.

## 15. Numerical diagnostics

Каждый solve сохраняет:

```text
relativeResidual
minPivotRatio
maximumNodeEquilibriumResidual
globalMomentResidual
buckling residual
```

Результат с неудовлетворительной диагностикой не должен молча отображаться как надёжный.

## 16. Verification layers

### Analytical

- axial `FL/EA`;
- cantilever `PL³/(3EI)`;
- cantilever rotation `PL²/(2EI)`;
- fixed-fixed uniform load `qL/2`, `qL²/12`;
- analytical eigensystems.

### Invariants

- force equilibrium;
- moment equilibrium;
- regular-octahedron equal edges;
- alternating geometry regression;
- coordinate-rotation invariance;
- UI/report contracts.

### Independent FEM cross-check

Reference models from a separate solver must eventually live under a dedicated validation directory and be compared in CI with explicit tolerances.

## 17. CI as part of calculation architecture

Calculation software is not considered changed safely until:

```text
syntax checks
CI policy tests
unit/analytical tests on Linux
unit/analytical tests on macOS
unit/analytical tests on Windows
secret scan
static-site smoke test
```

have passed.

Подробности: [`CI_CD_REVIEW.md`](CI_CD_REVIEW.md).

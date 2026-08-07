# Производительность расчёта и индикация прогресса

Статус: архитектура производительности прототипа **1.1**.

## 1. Global frame scale

Для 40 одинаковых модулей:

```text
41 level
123 node
738 total DOF
720 free DOF after rigid base fixation
```

Topology соединяет только один level и соседние levels, поэтому при level-order numbering глобальная stiffness matrix ленточная.

Текущий regression invariant:

```text
half-bandwidth <= 35
```

Dense storage `O(n²)` и dense factorization `O(n³)` для production path не требуются.

## 2. Symmetric band Cholesky

`site/engine/banded.js` хранит только нижнюю симметричную ленту.

При `n=720`, `b=35` порядок storage:

```text
n*(b+1) = 720*36 = 25920 values
```

вместо:

```text
n² = 518400 values
```

Asymptotics:

```text
storage       O(n*b)
factorization O(n*b²)
solve         O(n*b)
```

## 3. Compile once, solve many

`compileFrameSystem()` один раз на geometry/material/diameter/restraints выполняет:

```text
member geometry/transforms
free DOF map
K assembly
banded Cholesky(K)
```

После этого operational wind cases, lateral cases и static-payload trials переиспользуют factorization.

Invariant:

```text
stiffnessFactorizationCount = 1
```

для одного complete calculation текущей geometry.

## 4. Matrix-free global buckling

Eigenproblem:

```text
(K + lambda*KG)*phi = 0
```

переписывается как оператор:

```text
A(v) = solve(K,-KG*v)
mu = eigenvalue(A)
lambda = 1/mu
```

Явный `K^-1` и dense transformed matrix не строятся.

Generalized Lanczos использует готовую band Cholesky factorization и проверяет actual generalized residual.

## 5. Новый modular static path 1.1

Issue #18 добавляет второй static solver, но не возвращает приложение к dense global algebra.

Один physical module имеет:

```text
3 bottom node * 6 DOF = 18
3 top node    * 6 DOF = 18
module total           = 36 DOF
```

`compileModuleStack()` собирает только 36×36 stiffness каждого physical module и выполняет top-down Schur recursion по 18×18 interface matrices.

Для `N` modules:

```text
interface factorizations = N
matrix size per factorization = 18×18
```

То есть дополнительная стоимость static cross-check растёт примерно линейно с числом modules и не требует второго factorization глобальной 720×720 system.

## 6. Почему modular solver не заменяет global factorization полностью

Для обычного static response Schur stack mathematically equivalent global assembly и используется как independent cross-check.

Но global eigen-buckling требует coupled `K/KG` всей мачты. Поэтому текущая performance architecture:

```text
global banded K: once
modular 18x18 Schur factors: once per module
static cases: both paths
buckling: global matrix-free path only
```

Это сознательно сохраняет независимость проверок и корректность global modes.

## 7. Maximum-height search

Наивный вариант issue #18 мог бы считать:

```text
N = 1,2,3,...,heightSearchMaxModules
```

что стало бы дорого при верхней границе 200–500 modules.

Поэтому `calculateMaximumHeight()` использует:

```text
1. exponential bracketing: 1,2,4,8,...
2. binary refinement PASS/FAIL interval
3. local integer neighbourhood scan around boundary
```

При монотонной границе число candidate geometries имеет порядок:

```text
O(log Nmax) + small constant neighbourhood
```

а не `O(Nmax)`.

Local scan нужен для контроля возможного discrete parity effect от alternating 60° orientation.

`result.heightCapacity.evaluationCount` и `performance.heightSearchEvaluationCount` позволяют regression-test отслеживать фактическое число candidate solves.

## 8. Ограничение поиска высоты

`heightSearchMaxModules` является protective upper bound, default `200`, hard-clamped to `500`.

Если failure до этой границы не найден:

```text
bounded = false
```

и UI/report показывают `>= Hsearch` вместо того, чтобы выдавать search bound за физический maximum.

## 9. Web Worker

Тяжёлые операции выполняются в `site/calculation-worker.js`:

```text
operational global FEM
modular Schur cross-check
buckling
lateral capacity
static payload search
height capacity search
rebar diameter optimization
verification augmentation
```

Main thread выполняет только:

```text
form/UI
progress/ETA
full mast canvas
selected-module canvas
CSV/paper rendering from finished result
```

## 10. Progress contract

Core callback:

```js
{
  phase,
  label,
  completed,
  total
}
```

Major phases 1.1:

```text
compile
wind
lateral
static-payload
height-capacity
done
```

UI переводит это в fraction, elapsed time и ETA.

## 11. Height progress budget

`HEIGHT_SEARCH_PROGRESS_STEPS` задаёт фиксированный budget progress bar, а actual candidate count сохраняется отдельно.

Это разделяет:

- UX progress contract;
- реальное число evaluated module counts.

Даже если cache или search strategy меняются, progress остаётся монотонным и заканчивается на 100%.

## 12. Cancel

Пользовательская отмена:

```js
worker.terminate()
```

немедленно останавливает текущий calculation job и освобождает main UI для нового запуска.

## 13. Rebar optimization

`selectUniformDiameter()` проверяет standard rebar diameters по возрастанию и может остановиться на первом проходящем.

Optimization candidates используют обычный global calculation. После выбора minimum diameter выполняется complete result, который уже включает modular analysis, height capacity, connections и verification.

Так expensive full reporting/height search не должен без необходимости повторяться для каждой строковой candidate diameter сверх существующей optimization logic.

## 14. Regression expectations

CI контролирует минимум:

```text
40 modules
720 free DOF
bandwidth <= 35
global K factorization count = 1
finite wind/lateral/static results
modular/global difference < 1e-8
module interface residual < 1e-8
height search finite evaluation count
verification internal checks pass
progress monotonic and final 100%
```

Runtime guard является защитой от возврата к minute-scale dense behavior, а не обещанием одинакового millisecond time на любом CPU.

## 15. Static-site smoke

CI запускает HTTP server над `site/` и проверяет доступность browser entry points, включая:

```text
app.js
calculation-worker.js
viewer.js
module-viewer.js
engine/solver.js
engine/module-stack.js
engine/module-verification.js
engine/banded.js
engine/buckling.js
engine/connection-check.js
engine/calculation-project.js
```

Это предотвращает ситуацию, когда Node tests проходят, но GitHub Pages не может загрузить новый ES module.

## 16. Future performance work

Если будет добавлена geometric nonlinearity/P-Delta/contact:

- `K` перестанет быть полностью reusable between iterations;
- current linear Schur factors также потребуют update;
- progress должен учитывать nonlinear iterations;
- performance regressions нужно будет разделить на linear and nonlinear modes.

Нельзя механически переносить текущую `compile once, solve many` гарантию на nonlinear model.

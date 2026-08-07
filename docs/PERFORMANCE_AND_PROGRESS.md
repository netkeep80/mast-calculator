# Производительность расчёта и индикация прогресса

Статус: архитектура производительности прототипа **1.2**.

## 1. Масштаб global frame

Для 40 одинаковых модулей:

```text
41 level
123 node
738 total DOF
720 free DOF after rigid base fixation
```

Topology соединяет только соседние уровни, поэтому при level-order numbering матрица жёсткости имеет малую полуширину. Regression invariant:

```text
half-bandwidth <= 35
```

Production path не требует dense global storage/inverse.

## 2. Symmetric band Cholesky

`site/engine/banded.js` хранит нижнюю симметричную ленту.

Для `n=720`, `b=35`:

```text
storage ~ n*(b+1) = 25920 values
factorization ~ O(n*b^2)
solve ~ O(n*b)
```

Вместо dense:

```text
storage O(n^2)
solve/factorization O(n^3)
```

`compileFrameSystem()` factorizes `K` один раз на geometry, затем фактор используется всеми operational wind cases и специальными load cases той же геометрии.

## 3. Помодульный static solver

Каждый module — 36 DOF, интерфейс — 18 DOF.

Top-down Schur condensation и bottom-up recovery используют `N` небольших interface factorizations вместо dense inverse полной мачты.

Помодульный путь одновременно является second solver и cross-check global FEM.

## 4. Dense third solver — только CI oracle

`reference-frame.js` специально использует dense global matrices и Gaussian elimination, чтобы численно и архитектурно отличаться от production solver.

Он не включён в обычный пользовательский Worker calculation. Dense reference запускается только в ограниченных тестовых моделях dedicated `Triple FEM equivalence`.

Иначе независимая проверка резко ухудшила бы время и память браузерного расчёта больших мачт.

## 5. Exact rotational symmetry ветра

Полная пользовательская угловая сетка сначала строится логически, затем удаляются только точные повторы, связанные с 120° вращательной симметрией трёхгранной мачты.

При default step 30°:

```text
12 directions full circle
-> 4 unique FEM solves
0, 30, 60, 90 deg
```

Это не приближённая редукция, а использование симметрии текущей идеальной модели.

## 6. Автоконфигуратор узла и производительность

Issue #21 добавляет конечный discrete catalogue:

```text
bolt classes
bolt diameters
clearance nuts
coupling nuts
standard bolt lengths
weld inputs
```

Для каждого bolt candidate выполняются только малые algebraic operations над уже полученными joint resultants:

```text
candidate geometry
reff
Nt/Ns
bolt capacity
geometry checks
```

Новый configurator не выполняет новый global FEM solve для каждого bolt candidate.

## 7. Критический invariant: выбранный узел фиксируется

`calculateCompleteMastWithConfiguredJoint()` выполняет operational solve и только затем выбирает physical joint.

После выбора:

```text
jointConfiguratorMode = manual internally
resolved physical parameters are frozen
```

С этой же сборкой выполняются:

```text
lateral capacity
static top payload
maximum-height search
```

Это не только физическая корректность, но и performance invariant: trial calculations не запускают новый catalogue search и не меняют изделие на каждой итерации.

## 8. Подбор арматуры и узла

`selectUniformDiameter()` проверяет standard rebar diameters по возрастанию.

Для каждого diameter operational `calculateMast()` автоматически конфигурирует подходящий joint. Вариант проходит только при:

```text
strength
serviceability displacement
global buckling
physical connection
```

Поиск прекращается на первом проходящем standard diameter. После этого только один раз выполняется полный `calculateCompleteMastWithConfiguredJoint()` для окончательного выбранного комплекта.

## 9. Maximum-height search

Полный linear scan `1..Nmax` запрещён.

Используется:

```text
exponential bracketing
binary refinement
local integer neighbourhood scan
```

Это особенно важно, потому что candidate height требует полноценного frame/buckling/connection calculation.

## 10. Static payload search

Максимальная top mass находится bracket/binary search, а не мелким линейным шагом.

На каждой trial mass используются уже скомпилированная geometry/global stiffness и один фиксированный physical joint.

## 11. Web Worker

Heavy calculations не выполняются в main UI thread.

Поток:

```text
app-bootstrap.js / app.js
        |
        v
calculation-worker.js
        |
        v
calculateCompleteMastWithConfiguredJoint()
```

Main thread получает только:

```text
progress
result
error
```

Отмена:

```js
worker.terminate()
```

## 12. Progress phases

Пользователь видит не только spinner, а semantic этапы:

```text
compile
wind
lateral
static-payload
height-capacity
optimize
done
```

Для optimization текст явно говорит о подборе арматуры **и соединительного узла**.

Интерфейс показывает:

- процент;
- текущий этап;
- деталь текущего расчёта;
- прошедшее время;
- ETA после накопления достаточной статистики;
- кнопку отмены.

## 13. CI performance protection

Регрессионные тесты проверяют:

```text
free DOF for 40 modules = 720
half-bandwidth <= 35
stiffness factorization count = 1
module/global equality
bounded complete calculation time
height-search evaluation bound
```

Отдельные dedicated jobs не подменяют полный suite:

```text
Triple FEM equivalence
Joint configurator
Tests Ubuntu/macOS/Windows
```

`Joint configurator` дешёв и проверяет M24/M30/80 reference assembly, auto/manual и freeze invariant.

## 14. Почему время CI больше времени одного браузерного расчёта

Полный CI сознательно повторяет тесты:

- dedicated narrow gate даёт понятную причину ошибки;
- тот же код входит в `npm test` на трёх ОС;
- performance regression отдельно считает 40-module case;
- triple solver использует медленный dense oracle.

Это избыточность для доверия, а не production overhead пользователя.

## 15. Что потребует пересмотра performance architecture

Текущие оптимизации относятся к линейной ideal-rigid-joint модели.

При добавлении:

```text
P-Delta
material nonlinearity
contact/slip
nonlinear joint stiffness
incremental load stepping
```

нельзя механически сохранять правило «K factorized once». Тогда потребуются iteration/update/factorization policies и новая performance baseline.

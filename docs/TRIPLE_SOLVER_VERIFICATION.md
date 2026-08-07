# Тройная независимая проверка расчёта мачты

Статус: verification architecture прототипа 1.1, дополнение к issue #18.

## 1. Зачем нужен третий способ расчёта

После перехода на помодульный Schur solver одна и та же линейная статическая задача уже решается двумя путями:

```text
A. production global FEM
   full mast assembly
   symmetric band storage
   Cholesky solve

B. production module solver
   36-DOF physical module
   18-DOF interfaces
   top-down Schur condensation
   bottom-up back-substitution
```

Этого достаточно для сильной внутренней проверки, но оба пути всё ещё используют одну физическую Euler–Bernoulli frame-модель. Ошибка, случайно повторённая в обоих assembly path, теоретически могла бы остаться незамеченной.

Поэтому добавлен третий, verification-only путь:

```text
C. independent dense reference FEM
   independent geometry reconstruction
   independent 12x12 frame-element stiffness construction
   independent consistent distributed-load vector
   independent dense global assembly
   Gaussian elimination with partial pivoting
   independent member end-force recovery
   independent dense geometric-stiffness assembly
   dense generalized buckling reference for small/medium cases
```

Он реализован в `packages/structural-analysis/src/reference-frame.js`.

## 2. Принцип независимости

`reference-frame.js` намеренно не импортирует:

```text
solver.js
module-stack.js
banded.js
```

То есть третий путь не использует:

- production member geometry objects;
- production global band matrix;
- production Cholesky factorization;
- production load assembly;
- production member-force recovery;
- module Schur matrices.

Общими остаются только математически нейтральные reference utilities:

- dense Gaussian solver из `linear-algebra.js`;
- dense generalized eigen reference из `buckling.js`.

Production application не использует dense reference solver для получения пользовательского результата. Это важно: проверяющий алгоритм не должен влиять на проверяемый результат.

## 3. Что сравнивается

Для одного и того же `model + loadCase` CI получает три решения:

```text
u_global
u_schur
u_dense
```

Сравниваются попарно все шесть DOF каждого узла:

```text
ux, uy, uz, rx, ry, rz
```

Также сравниваются:

```text
base reactions: Fx,Fy,Fz,Mx,My,Mz
all 12 local end-force components of every member
module interface equilibrium
linear-system residuals
free-DOF equilibrium residuals
```

Для малых и средних scenarios дополнительно независимо собирается dense `KG` и сравнивается критический множитель:

```text
(K + lambda*KG)*phi = 0
```

между production matrix-free/banded Lanczos и dense reference eigen path.

Форма собственного вектора напрямую не сравнивается из-за допустимого изменения знака и особенностей нормировки; сравниваются `lambda_cr` и невязки исходного generalized equation.

## 4. Численные допуски

Требование — не просто инженерно близкие результаты, а совпадение на уровне ошибок floating-point.

Для перемещений и поворотов CI использует порядок:

```text
relative <= 2e-9 ... 3e-9
absolute <= 2e-12 ... 3e-12
```

Для реакций и member end forces:

```text
relative <= 3e-9 ... 5e-9
absolute <= несколько микроньютонов / микроньютон-метров
```

Для `lambda_cr` двух существенно разных eigen algorithms используется более мягкий, но всё ещё численный допуск:

```text
relative < 2e-5
```

при обязательной проверке residual обоих методов `<1e-5`.

Это не коэффициенты запаса и не допускаемая погрешность конструкции. Это только критерии идентичности численных реализаций одной математической модели.

## 5. Набор CI scenarios

Файл `tests/triple-solver-crosscheck.test.js` содержит отдельные regression scenarios:

1. один модуль, только собственный вес;
2. два модуля, косой ветер + оборудование + дополнительные узловые нагрузки;
3. четыре модуля, ветер + лёд + вертикальная нагрузка, включая независимый `lambda_cr`;
4. семь модулей, большая чистая боковая сила;
5. десять модулей, комбинированный эксплуатационный случай;
6. двенадцать модулей — масштаб фактически изготовленной/проектируемой мачты.

Отдельный test проверяет саму архитектурную независимость reference solver: запрещены imports production global/Schur/banded implementations.

## 6. Отдельный CI gate

В `.github/workflows/ci.yml` есть самостоятельный job:

```text
Triple FEM equivalence
```

Он запускает:

```bash
npm run test:triple
```

и является отдельным PR gate наряду с общими unit/regression tests.

Полный `npm test` также включает эти тесты и выполняется на:

```text
Ubuntu
macOS
Windows
```

Поэтому triple comparison проверяется как выделенным job, так и в общей cross-platform regression suite.

## 7. Почему dense solver не используется постоянно в браузере

Dense reference intentionally имеет худшую асимптотику:

```text
memory ~ O(n^2)
solve  ~ O(n^3)
```

Production banded solver использует локальность мачты и существенно дешевле, а module Schur solver работает с маленькими 18/36-DOF blocks.

Поэтому dense implementation существует как независимый oracle для CI/reference задач и не включается в обычный пользовательский расчёт. Это сохраняет две важные вещи одновременно:

1. высокая производительность приложения;
2. независимость verification path от production path.

## 8. Граница доказанности

Совпадение трёх реализаций очень сильно подтверждает, что текущая **заявленная линейная ideal-rigid-joint frame-модель** реализована согласованно.

Но три внутренних solver не превращаются в независимую внешнюю инженерную экспертизу. Они не подтверждают автоматически:

- правильность идеализации реального болтового/сварного узла;
- нормативные сочетания нагрузок;
- P-Delta и initial imperfections;
- пластичность;
- усталость;
- реальную податливость фундамента;
- фактическое качество сварки и монтажа.

Поэтому external FEM, engineering review и physical test в verification passport по-прежнему должны оставаться отдельными уровнями доказательства.

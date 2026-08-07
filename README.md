# Mast Calculator

Статическое браузерное приложение для расчёта модульной телекоммуникационной мачты из сварных арматурных октаэдров. Backend не требуется: расчёт выполняется в браузере, публикация — через GitHub Pages.

Опубликованная версия: **https://netkeep80.github.io/mast-calculator/**

Документация:

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — требования и расчётные допущения;
- [`docs/CALCULATION_ARCHITECTURE.md`](docs/CALCULATION_ARCHITECTURE.md) — устройство FEM и численного solver;
- [`docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md`](docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md) — боковая нагрузка, Бофорт и solid-rod sanity-check;
- [`docs/STATIC_PAYLOAD_CAPACITY.md`](docs/STATIC_PAYLOAD_CAPACITY.md) — максимальная статическая масса на вершине и эквивалентный объём воды;
- [`docs/PERFORMANCE_AND_PROGRESS.md`](docs/PERFORMANCE_AND_PROGRESS.md) — banded solver, Worker, progress/ETA и performance regression;
- [`docs/CI_CD_REVIEW.md`](docs/CI_CD_REVIEW.md) — CI/CD.

## Прототип 0.8

Версия 0.8 добавляет к быстрому 3D frame solver отдельный расчёт **максимальной статической массы на вершине** для задач вроде водонапорной башни.

Основные возможности текущей версии:

1. правильная геометрия октаэдров из закупочной длины арматуры;
2. жёсткая 3D Euler–Bernoulli frame FEM, 6 DOF/узел;
3. symmetric band Cholesky и одна факторизация `K` для всех load cases;
4. matrix-free generalized Lanczos для global eigen-buckling;
5. ветровая огибающая с точной 120° rotational symmetry;
6. отдельная проверочная боковая нагрузка вершины;
7. отдельная gravity-only грузоподъёмность вершины с учётом собственного веса мачты;
8. вывод остатка массы после уже заданного оборудования и дополнительной вертикальной силы;
9. перевод остатка в м³ и литры воды при `ρ = 1000 кг/м³`;
10. Web Worker, progress, elapsed time, ETA и отмена;
11. regression tests на Linux/macOS/Windows, включая 40-модульную модель.

## Геометрия

Пользователь задаёт закупочную длину прутка и число частей. До учёта kerf/trim/joint overlap:

```text
a = Lstock / nparts
R = a / sqrt(3)
h = a * sqrt(2/3)
H = Nmodules * h
```

Один правильный октаэдр содержит:

```text
3 horizontal members
6 diagonal members
= 9 members
```

Все девять рёбер имеют длину `a`; это regression invariant.

## 3D frame FEM

Каждый узел имеет 6 DOF:

```text
[ux, uy, uz, rx, ry, rz]
```

Круглый Euler–Bernoulli frame-element учитывает:

```text
EA
EIy
EIz
GJ
```

Solver возвращает:

```text
N
Vy, Vz
T
My, Mz
```

а также перемещения, повороты, реакции, реактивные моменты, stress utilization и форму общей потери устойчивости.

Нижние три узла пока полностью заделаны. Реальный фундамент — отдельный будущий слой.

## Нагрузки

В эксплуатационных случаях реализованы:

- собственный вес арматуры;
- цилиндрический слой льда;
- ветер на пространственно ориентированные рёбра;
- масса и ветер оборудования;
- дополнительные горизонтальная и вертикальная нагрузки;
- огибающая по направлениям ветра.

Собственный вес, лёд и ветер — distributed member loads. Для цилиндрического ребра используется только нормальная к его оси составляющая ветра.

## Погодные сценарии

UI содержит полную шкалу Бофорта 0–12 и ручной режим ветрового давления.

Для preset:

```text
q = rho*v²/2
rho = 1.225 kg/m³
```

Beaufort 12 начинается с 33 м/с. Эти preset — сравнительные сценарии, а не замена нормативному wind design по СП 20.

## Проверка рёбер

Для круглого сечения:

```text
A = pi*d²/4
I = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
```

Упругая проверка объединяет `N`, изгиб, поперечный срез и кручение по фон Мизесу.

Сжатый member дополнительно проверяется по Эйлеру:

```text
mu = 0.5
N_E = pi²*E*I/(mu*L)²/gamma_M
```

Итоговое использование — максимум stress check и local Euler check.

## Общая устойчивость

Исходная задача:

```text
(K + lambda*KG)*phi = 0
```

Оператор применяется matrix-free:

```text
v -> -KG*v -> solve(K, ...) -> K^-1(-KG)v
```

`solve(K, ...)` использует заранее готовую banded Cholesky-факторизацию. Lanczos проверяется по фактической невязке исходной generalized eigen-задачи.

## Compile once, solve many

`compileFrameSystem()` один раз выполняет:

```text
member geometry/transforms
free DOF map
assembly K
banded Cholesky(K)
```

Затем все направления и специальные проверки одной геометрии используют ту же факторизацию:

```text
stiffnessFactorizationCount = 1
```

Для 40 модулей:

```text
free DOF = 720
half-bandwidth = 35
```

Подробности complexity: [`docs/PERFORMANCE_AND_PROGRESS.md`](docs/PERFORMANCE_AND_PROGRESS.md).

## 120° symmetry

Идеальная трёхгранная модель периодична при повороте на 120°.

Оптимизация сначала строит полную сетку `0..360°`, затем приводит каждый угол modulo 120° и удаляет только физически эквивалентные дубликаты.

Default step 30°:

```text
12 full-circle samples -> 4 unique FEM solves
0°, 30°, 60°, 90°
```

Для шагов, не делящих 120°, сохраняются все уникальные остатки; это покрыто regression test.

## Боковая нагрузка вершины

Проверочный load case:

```text
F0 = 1 N horizontal at top
```

В нём отключены эксплуатационный ветер, лёд, собственный вес, оборудование и дополнительные нагрузки.

Благодаря линейности:

```text
Fmember = 1/U(1 N)
Fglobal = lambda_cr(1 N)*1 N
Flim = min(Fmember, Fglobal)
```

Проверяется 120° сектор с шагом по умолчанию 15°.

UI отдельно показывает первый предел, global buckling limit, механизм и значения в Н/кН/кгс.

Это характеристика идеальной линейной модели, а не паспортная грузоподъёмность крана.

## Максимальная статическая масса на вершине

Для issue #11 введён отдельный gravity-only сценарий:

```text
включено:
  собственный вес мачты * deadLoadFactor
  суммарная масса на вершине * equipmentLoadFactor

исключено:
  ветер
  лёд
  горизонтальные силы
  прочие дополнительные нагрузки
```

Масса прикладывается вертикально вниз поровну к трём верхним узлам.

Для пробной массы `m`:

```text
Pnom = m*g
Pdesign = m*g*equipmentLoadFactor
```

Предел определяется одновременно по двум условиям:

```text
U_member(m) <= 1
lambda_cr(m) >= 1
```

Собственный вес не обнуляется, поэтому финальный результат нельзя получить простым масштабированием случая 1 кг. Чистый случай 1 кг без собственного веса используется только как верхняя граница, затем выполняется 18 итераций двоичного поиска уже с собственным весом.

UI показывает:

```text
maximumTotalTopMassKg
remainingAdditionalMassKg
equivalentWaterVolumeM3
equivalentWaterVolumeLiters
governingMode
```

Уже введённые оборудование и дополнительная вертикальная сила переводятся в эквивалентную массу и вычитаются из общего предела:

```text
m_existing = equipmentMassKg
           + extraVerticalLoadN/(g*equipmentLoadFactor)

m_remaining = max(0, m_max - m_existing)
```

Для воды используется инженерное значение:

```text
rho_water = 1000 kg/m³
Vwater = m_remaining/rho_water
```

То есть при отсутствии прочего оборудования 1000 кг резерва отображаются примерно как 1 м³ или 1000 л воды.

Подробная постановка и ограничения: [`docs/STATIC_PAYLOAD_CAPACITY.md`](docs/STATIC_PAYLOAD_CAPACITY.md).

## Solid-rod sanity-check

Для специального случая

```text
d_rib = a/2
D_solid = 2a/sqrt(3)
A6/Asolid = 9/8 = 1.125
```

решётчатая мачта сравнивается со сплошной круглой консолью той же высоты и габарита по боковой предельной силе и линейной жёсткости `K=F/delta`.

## Web Worker и progress

`site/calculation-worker.js` выполняет FEM, eigen-buckling и подбор диаметра вне main thread.

Main thread остаётся свободным для формы, progress UI, 3D viewer и экспорта отчёта.

Во время вычисления пользователь видит:

- progress bar и процент;
- текущий этап и направление/candidate;
- отдельный этап «Статическая нагрузка вершины»;
- прошедшее время;
- ETA;
- кнопку **«Отменить расчёт»**.

Отмена выполняется через `worker.terminate()` и не ждёт завершения текущей eigen-итерации.

## Подбор диаметра

Стандартные диаметры проверяются по возрастанию. Первый вариант, который одновременно проходит по прочности, прогибу и общей устойчивости, является минимальным искомым, поэтому более крупные размеры не считаются.

После выбора выполняется полный итоговый расчёт найденного диаметра, включая lateral capacity и static top payload capacity.

## Бумажный расчётный проект

Кнопка **«Скачать расчётный проект»** формирует автономный HTML для печати/PDF и передачи инженеру.

Документ включает исходные данные, геометрию, section properties, нагрузки, frame equations, `N/V/T/M`, stress/Euler checks, global buckling, погоду, боковую нагрузку и отдельный вывод максимальной статической массы/объёма воды.

В бумажном проекте нет JSON. Internal `CalculationSnapshot v5` остаётся regression/debug format.

## Верификация

Suite проверяет, в частности:

- `FL/EA`;
- `PL³/(3EI)` и `PL²/(2EI)`;
- fixed-fixed `qL/2`, `qL²/12`;
- force/moment equilibrium;
- geometry invariants;
- banded Cholesky vs dense reference;
- generalized Lanczos vs dense reference;
- 120° symmetry reduction;
- Beaufort 0–12;
- lateral capacity;
- static top payload capacity с собственным весом;
- перевод payload reserve в объём воды;
- независимость gravity-only capacity от ветра и льда;
- рост payload capacity с диаметром;
- 40-module performance + residual regression;
- solid-rod sanity-check;
- early-stop diameter optimization;
- Worker/progress/ETA/cancel UI contract;
- CI policy.

До признания программы окончательным инженерным инструментом требуется cross-check с независимым КЭ-комплексом.

## Ограничения

Пока не реализованы:

- реальная геометрия соединительного узла;
- kerf/trim/overlap;
- нормативный расчёт болтов, резьбы, гаек и сварки;
- полноценные нормативные сочетания;
- geometric nonlinearity/P-Delta;
- initial imperfections;
- пластичность и усталость;
- параметрический фундамент;
- независимые external FEM reference results.

Для водонапорной башни отдельно необходимо учитывать ветровую площадь и эксцентриситет бака, динамику воды, реальные соединения и фундамент. Gravity-only `m_max` — полезная отдельная характеристика, но не полный проект башни.

## CI/CD

PR CI:

```text
Syntax, policy and maintainability
Secrets scan
Tests — Ubuntu
Tests — macOS
Tests — Windows
Static site smoke test
```

Smoke проверяет Worker и browser modules `banded.js`, `buckling.js`, `weather.js`, `lateral-capacity.js`, `static-payload-capacity.js` и report layer.

## Локальный запуск

```bash
python3 -m http.server 8080 --directory site
```

Открыть `http://localhost:8080/`.

Проверки:

```bash
npm test
npm run check
node scripts/check-file-line-limits.mjs
```

Runtime npm-зависимостей нет. Node.js используется для tests и CI utilities.

## Единицы

Внутри ядра — SI: метры, ньютоны, паскали, радианы и килограммы. UI и бумажный проект преобразуют единицы на границе системы. Для статической нагрузки явно различаются масса `кг`, сила `Н` и, для боковой испытательной характеристики, `кгс`.

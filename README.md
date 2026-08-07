# Mast Calculator

Статическое браузерное приложение для расчёта модульной телекоммуникационной мачты из сварных арматурных октаэдров. Backend не требуется: расчёт выполняется в браузере, публикация — через GitHub Pages.

Опубликованная версия: **https://netkeep80.github.io/mast-calculator/**

Документация:

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — требования и расчётные допущения;
- [`docs/CALCULATION_ARCHITECTURE.md`](docs/CALCULATION_ARCHITECTURE.md) — устройство FEM и численного solver;
- [`docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md`](docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md) — боковая нагрузка, Бофорт и solid-rod sanity-check;
- [`docs/PERFORMANCE_AND_PROGRESS.md`](docs/PERFORMANCE_AND_PROGRESS.md) — оптимизация issue #10, Worker, progress/ETA и benchmark;
- [`docs/CI_CD_REVIEW.md`](docs/CI_CD_REVIEW.md) — CI/CD.

## Прототип 0.7

Версия 0.7 сохраняет физическую 3D frame-постановку 0.6, но полностью меняет вычислительный путь длительных расчётов:

1. `K` хранится как симметричная ленточная матрица;
2. используется banded Cholesky вместо повторного dense `O(n³)` solve;
3. геометрия элементов и `Cholesky(K)` компилируются один раз для всех load cases одной модели;
4. global eigen-buckling решается matrix-free generalized Lanczos без явного `K^-1`;
5. Lanczos останавливается по фактической невязке `(K + λKG)φ`;
6. полная ветровая сетка сворачивается по точной 120° rotational symmetry;
7. тяжёлый FEM и подбор диаметра вынесены в Web Worker;
8. UI показывает progress, текущий этап, elapsed time, ETA и кнопку отмены;
9. подбор диаметра прекращается на первом проходящем стандартном размере;
10. CI содержит 40-модульный performance regression.

Финальное измерение GitHub-hosted Ubuntu runner после проверки невязок:

```text
40 modules
720 free DOF
half-bandwidth = 35
1 factorization of K
4 wind cases + 8 lateral cases
1078.3 ms
```

Это не обещание браузеру укладываться ровно в 1,08 с на любом железе; benchmark нужен как защита от возврата к минутному dense-поведению.

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

Реализованы:

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

Исходная задача не изменилась:

```text
(K + lambda*KG)*phi = 0
```

В 0.7 оператор применяется matrix-free:

```text
v -> -KG*v -> solve(K, ...) -> K^-1(-KG)v
```

`solve(K, ...)` использует уже готовую banded Cholesky-факторизацию.

Малая generalized eigen-задача в tests сравнивает Lanczos с dense reference. 40-модульный regression дополнительно контролирует фактическую buckling residual.

## Compile once, solve many

`compileFrameSystem()` один раз выполняет:

```text
member geometry/transforms
free DOF map
assembly K
banded Cholesky(K)
```

Затем все направления одной геометрии используют одну факторизацию:

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

Оптимизация сначала строит прежнюю полную сетку `0..360°`, затем приводит каждый угол modulo 120° и удаляет только точные эквиваленты.

Default step 30°:

```text
12 full-circle samples -> 4 unique FEM solves
0°, 30°, 60°, 90°
```

Для шагов, не делящих 120°, сохраняются все уникальные остатки; это покрыто отдельным тестом.

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

UI отдельно показывает:

- первый предел боковой нагрузки;
- боковую силу общей потери устойчивости;
- механизм первого предела;
- Н/кН/кгс.

Это характеристика идеальной линейной модели, а не паспортная грузоподъёмность крана.

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

Main thread остаётся свободным для:

```text
формы
progress UI
3D viewer
экспорта отчёта
```

Во время вычисления пользователь видит:

- progress bar и процент;
- текущий этап и направление/candidate;
- прошедшее время;
- ETA;
- кнопку **«Отменить расчёт»**.

Отмена выполняется через `worker.terminate()` и не ждёт завершения текущей eigen-итерации.

## Подбор диаметра

Стандартные диаметры проверяются по возрастанию. Первый вариант, который одновременно проходит по прочности, прогибу и общей устойчивости, уже является минимальным искомым, поэтому более крупные размеры не считаются.

После выбора выполняется полный итоговый расчёт найденного диаметра, включая lateral capacity.

## Бумажный расчётный проект

Кнопка **«Скачать расчётный проект»** формирует автономный HTML для печати/PDF и передачи инженеру.

Документ включает исходные данные, геометрию, section properties, нагрузки, frame equations, `N/V/T/M`, stress/Euler checks, global buckling, погоду, `Fmember/Fglobal/Flim`, таблицы cases, diagnostics и ограничения.

В бумажном проекте нет JSON. Internal `CalculationSnapshot v4` остаётся regression/debug format.

## Верификация

Текущий suite содержит **82 теста** и проверяет, в частности:

- `FL/EA`;
- `PL³/(3EI)` и `PL²/(2EI)`;
- fixed-fixed `qL/2`, `qL²/12`;
- force/moment equilibrium;
- geometry invariants;
- banded Cholesky vs dense reference;
- generalized Lanczos vs dense reference;
- 120° symmetry reduction;
- 40-module performance + residual regression;
- Beaufort 0–12;
- lateral capacity;
- solid-rod sanity-check;
- early-stop diameter optimization;
- Worker/progress/ETA/cancel UI contract;
- CI policy.

До признания программы окончательным инженерным инструментом всё ещё требуется cross-check с независимым КЭ-комплексом.

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

Оптимизация 0.7 меняет численный путь, но не отменяет ограничения физической модели.

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

Smoke дополнительно проверяет выдачу Worker и browser modules `banded.js`, `buckling.js`, `weather.js`, `lateral-capacity.js` и report layer.

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

Внутри ядра — SI: метры, ньютоны, паскали, радианы и килограммы. UI и бумажный проект преобразуют единицы на границе системы.
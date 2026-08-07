# Mast Calculator

Статическое браузерное приложение для расчёта модульной мачты из сварных арматурных октаэдров. Backend не требуется: расчёт выполняется в браузере, публикация — через GitHub Pages.

Опубликованная версия: **https://netkeep80.github.io/mast-calculator/**

Документация:

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — требования и допущения;
- [`docs/CALCULATION_ARCHITECTURE.md`](docs/CALCULATION_ARCHITECTURE.md) — FEM, solver и data flow;
- [`docs/MODULAR_ANALYSIS_AND_HEIGHT.md`](docs/MODULAR_ANALYSIS_AND_HEIGHT.md) — модульная схема, подробная визуализация и поиск предельной высоты;
- [`docs/TRIPLE_SOLVER_VERIFICATION.md`](docs/TRIPLE_SOLVER_VERIFICATION.md) — тройная независимая numerical verification global/Schur/dense;
- [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md) — межмодульный болт и сварные концы;
- [`docs/VERIFICATION_FOR_NON_SPECIALISTS.md`](docs/VERIFICATION_FOR_NON_SPECIALISTS.md) — пошаговая верификация;
- [`docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md`](docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md) — боковая нагрузка и погода;
- [`docs/STATIC_PAYLOAD_CAPACITY.md`](docs/STATIC_PAYLOAD_CAPACITY.md) — максимальная масса на вершине;
- [`docs/PERFORMANCE_AND_PROGRESS.md`](docs/PERFORMANCE_AND_PROGRESS.md) — Worker/performance;
- [`docs/CI_CD_REVIEW.md`](docs/CI_CD_REVIEW.md) — CI/CD.

## Прототип 1.1

Версия 1.1 меняет сам способ представления мачты, добавляет точный помодульный Schur solver и третий независимый dense FEM reference path для CI-проверки корректности.

### Физический модуль

Каждый одинаковый октаэдр устанавливается **ножками вниз**:

```text
верх модуля: 3 горизонтальных ребра
низ модуля: 3 опорные точки
между ними: 6 диагональных ножек
```

Поэтому один модуль всегда содержит ровно `9` рёбер, а мачта из `N` одинаковых модулей — `9N` рёбер. Верхний треугольник последнего модуля уже является частью этого модуля; отдельного `closeTopRing` больше нет.

Геометрия правильного октаэдра:

```text
a = Lstock/nparts
R = a/sqrt(3)
h = a*sqrt(2/3)
H = N*h
```

Нижние три узла первого модуля пока считаются идеально жёстко закреплёнными в фундаменте по всем 6 DOF.

## Три независимых пути расчёта и проверки

### 1. Production global banded FEM

Основной global solver остаётся 3D Euler–Bernoulli frame FEM с 6 DOF на узел:

```text
[ux,uy,uz,rx,ry,rz]
```

Он собирает всю мачту целиком и решает `K*u=F` через symmetric band Cholesky.

### 2. Production module Schur solver

Та же линейная статическая задача решается **помодульно сверху вниз**. Это не упрощённое суммирование веса. Каждый физический модуль рассматривается как 36-DOF substructure:

```text
18 DOF нижнего интерфейса = 3 узла × 6 DOF
18 DOF верхнего интерфейса = 3 узла × 6 DOF
```

Уже обработанный верхний стек заменяется точным Schur-эквивалентом на верхнем интерфейсе следующего модуля:

```text
A = Ktt + Supper
S = Kbb - Kbt * A^-1 * Ktb
```

Одновременно сверху вниз конденсируется фактическая нагрузка, поэтому нижний модуль получает от всех вышестоящих не только результирующую силу, но и полный набор сил/моментов по трём узлам и влияние жёсткости верхнего стека. После достижения заделанного основания перемещения восстанавливаются снизу вверх.

Для каждого operational load case приложение автоматически сравнивает полный вектор перемещений/поворотов modular solver с global banded FEM и контролирует равновесие интерфейсов соседних модулей.

### 3. Independent dense reference FEM

Для CI и reference verification добавлен `site/engine/reference-frame.js`. Он намеренно **не импортирует** production `solver.js`, `module-stack.js` или `banded.js` и независимо повторно строит:

```text
геометрию и локальные оси member
12x12 Euler-Bernoulli stiffness
consistent distributed-load vector
dense global K
boundary-condition reduction
member end-force recovery
dense KG для reference buckling
```

Линейная система решается dense Gaussian elimination с partial pivoting. Для малых/средних контрольных случаев дополнительно сравнивается `lambda_cr` с независимым dense generalized eigen path.

Этот третий solver **не участвует в пользовательском production result** и поэтому не может случайно «подправить» проверяемый ответ. Он существует как independent oracle для CI.

Dedicated CI gate сравнивает три пути на мачтах из 1, 2, 4, 7, 10 и 12 модулей: все `ux/uy/uz/rx/ry/rz`, реакции основания и все 12 local end-force components каждого ребра. Допуски для static state находятся на уровне `10^-9` relative / `10^-12` absolute для DOF; это floating-point tolerance, а не инженерный коэффициент запаса.

Подробности: [`docs/TRIPLE_SOLVER_VERIFICATION.md`](docs/TRIPLE_SOLVER_VERIFICATION.md).

**Global eigen-buckling не декомпозируется на независимые модули.** Общая потеря устойчивости физически является свойством всей связанной мачты, поэтому production задача

```text
(K + lambda*KG)*phi = 0
```

по-прежнему решается для полной конструкции. Dense reference eigen path используется только как независимая проверка на ограниченном наборе CI scenarios.

## Подробная визуализация модуля

Главная 3D-схема позволяет выбрать модуль кликом либо через список. Выбранный модуль подсвечивается.

Второе окно показывает только этот физический модуль:

- девять его рёбер;
- `N`, `V`, `M` на каждом ребре;
- красными стрелками — силы от всего вышестоящего стека на верхней грани;
- синими — реакции нижележащей части/фундамента;
- коричневыми — непосредственные узловые нагрузки;
- силы и моменты по каждому из трёх узлов интерфейса;
- критическое ребро и механизм вертикальной перегрузки.

Это позволяет последовательно смотреть мачту сверху вниз и видеть, как нагрузка на одинаковый модуль возрастает по мере приближения к фундаменту.

## Ведомость рёбер

`Ведомость рёбер по огибающей` теперь знает принадлежность каждого ребра физическому модулю. В UI можно:

- группировать по модулям или показывать единый список;
- сортировать по модулю, номеру ребра, `|N|`, `V`, `M`, `σэкв`, ветру или итоговому использованию;
- выбирать направление сортировки.

CSV также содержит номер физического модуля.

## Максимальная высота

Версия 1.1 выполняет отдельный дискретный поиск по целому числу одинаковых модулей до задаваемой верхней границы.

Проектный предел требует одновременно:

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= minimumBucklingFactor
delta_top <= displacementLimit
```

Отдельно показывается **предельная высота по сопротивлению** без эксплуатационного ограничения по прогибу:

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= 1
```

Поиск использует exponential bracketing, binary search и локальную проверку соседних целых высот, чтобы не пропустить эффект чередования поворота модулей на 60°.

Результат сообщает:

- максимальное число модулей;
- высоту в метрах;
- первый не проходящий вариант;
- определяющий критерий;
- отдельную оценку нижнего модуля по двум требуемым вертикальным механизмам: **локальная потеря устойчивости сжатой ножки** либо **растягивающий разрыв ножки по `Rm/γM`**.

Этот результат относится только к выбранным геометрии, материалу, болту, оборудованию, ветру, льду и коэффициентам. Он не является универсальной высотой данного изделия.

## Соединения

Connection layer версии 1.0 сохранён. Для каждого внутреннего стыка проверяется один вертикальный болт и сварные концы рёбер. Demand строится из совпадающих `N/V/T/M` одного load case, а не из независимых максимумов.

Для болта:

```text
Nt = max(0,-Faxis) + |Mb|/reff
Ns = |Fperp| + |T|/reff
Nbs = Rbs*Ab*ns*gamma_b*gamma_c
Nbt = Rbt*Abn*gamma_c
Ubolt = sqrt((Ns/Nbs)^2 + (Nt/Nbt)^2)
```

Сжатие контакта не превращается в фиктивное растяжение болта. Подробности: [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md).

## Lateral / static payload

Сохраняются отдельные специальные расчёты:

```text
F0 = 1 N horizontal at top
Flim = min(Fmember,Fglobal,Fbolt)
```

и gravity-only поиск максимальной массы на верхней грани:

```text
U_member(m) <= 1
U_bolt(m) <= 1
lambda_cr(m) >= 1
```

## Verification passport

Внутренний passport проверяет простые формулы, равновесие, аналитические frame benchmarks и независимые numerical algorithms. Для модульного слоя добавлены отдельные evidence items:

```text
3 top-ring + 6 leg на каждый модуль
interface force/moment equilibrium
u_modular ≈ u_global
```

Кроме runtime passport, CI имеет более сильный triple-solver regression: `global banded FEM ↔ module Schur ↔ independent dense FEM` с проверкой DOF, реакций, member end forces и `lambda_cr` на выбранных сценариях.

Независимый сторонний FEM, инженерная рецензия и натурный эксперимент остаются `NOT VERIFIED` до появления реальных внешних артефактов. Внутренний dense reference solver не выдаётся за сторонний FEM.

## Snapshot и paper project

Internal reproducibility format версии 1.1:

```text
mast-calculator/calculation-snapshot/v8
```

Он хранит physical module ownership, interface actions, modular/global cross-check и `heightCapacity`. Пользовательской JSON-кнопки нет.

Печатный HTML-проект должен оставаться человекочитаемым и содержать расчётную методику, предельную высоту, модульный баланс, соединения, формулы и ограничения модели.

## Ограничения

Пока не реализованы:

- реальная податливость болтового/сварного узла в глобальной `K`;
- thread stripping / actual engagement length;
- bearing/prying/preload/slip;
- точная геометрия weld group;
- fatigue;
- параметрический фундамент;
- P-Delta/geometric nonlinearity;
- initial imperfections и plasticity;
- нормативные сочетания СП 20 в полном объёме;
- внешний FEM cross-check реальной мачты.

## CI/CD и запуск

PR checks:

```text
Syntax, policy and maintainability
Secrets scan
Triple FEM equivalence
Tests: Ubuntu/macOS/Windows
Static site smoke
```

Локально:

```bash
python3 -m http.server 8080 --directory site
npm test
npm run test:triple
npm run check
node scripts/check-file-line-limits.mjs
```

Runtime npm dependencies: none.

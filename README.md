# Калькулятор мачты

Статическое браузерное приложение для расчёта модульной мачты из сварных арматурных октаэдров. Backend не требуется: тяжёлые вычисления выполняются в Web Worker, публикация — через GitHub Pages.

Опубликованная версия: **https://netkeep80.github.io/mast-calculator/**

## Прототип 1.4 — практические нагрузки без дублирования

Issue #36 упрощает пользовательскую модель нагрузки и добавляет отдельный расчёт горизонтальной стрелы.

Пользователь начинает с одного из четырёх вопросов:

1. **Проверить конкретную мачту** — выдержит ли конструкция заданную погоду и установленное оборудование;
2. **Подобрать конструкцию** — минимальный проходящий диаметр арматуры и согласованный физический узел;
3. **Узнать пределы** — максимальная высота, максимальная масса на вершине, сколько ещё килограммов можно добавить и какой концевой груз выдержит та же конструкция как горизонтальная стрела;
4. **Проверить расчёт** — алгоритм, residuals, global/Schur/dense cross-check, паспорт верификации и справочники.

Главное правило issue #36: одна физическая нагрузка не должна задаваться двумя способами. Из пользовательской модели удалены произвольные `extraHorizontalLoadN` и `extraVerticalLoadN`. Вертикальная нагрузка вершины задаётся одной понятной величиной — **массой оборудования/груза в килограммах**.

Внутренние известные силы, необходимые аналитическим тестам и normalized capacity cases, передаются через отдельный `topPointLoadN` API и не являются параметрами пользовательской формы.

Подробный контракт: [`docs/ISSUE_36_STATIC_LOAD_SIMPLIFICATION.md`](docs/ISSUE_36_STATIC_LOAD_SIMPLIFICATION.md).

## Раскрой арматуры

Закупочный пруток можно делить на любое целое число одинаковых частей:

```text
1, 2, 3, …, 48
```

До учёта ширины реза и технологических припусков:

```text
a = Lstock / nparts
```

Расчётное ядро отвергает нецелые значения и значения вне `1…48`.

## Физический модуль

Правильный октаэдр установлен ножками вниз:

```text
3 ребра верхнего треугольника
6 диагональных ножек
-----------------------------
9 рёбер на модуль
```

```text
a = Lstock / nparts
R = a/sqrt(3)
h = a*sqrt(2/3)
H = N*h
```

Три нижних production nodes пока имеют идеальную жёсткую заделку по шести DOF. Отдельные аналитические tests с шарнирными точечными опорами являются только verification fixtures.

## Эксплуатационные нагрузки

Production load layer использует:

- собственный вес арматурных рёбер;
- ветер;
- лёд;
- массу оборудования/груза на вершине;
- парусную площадь оборудования.

Legacy `extraHorizontalLoadN` и `extraVerticalLoadN`, даже если встретятся в старом объекте параметров, больше не изменяют production load case.

## Максимальная масса на вершине вертикальной мачты

Отдельная gravity-only задача отвечает на два практически нужных вопроса:

```text
maximumTopEquipmentMassKg
  максимальная суммарная масса оборудования/груза на верхней грани

additionalTopEquipmentMassKg
  сколько ещё кг можно добавить сверх уже установленной массы
```

Проверяются:

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= 1
```

Собственный вес мачты сохраняется; ветер и лёд в этой специальной задаче отключаются.

Отдельный structural output «эквивалентный объём воды» удалён. Если кому-то нужен объём, это обычное внешнее преобразование:

```text
V = m/rho
```

Подробнее: [`docs/STATIC_PAYLOAD_CAPACITY.md`](docs/STATIC_PAYLOAD_CAPACITY.md).

## Чистый поперечный unit-load

Существующий lateral validation case остаётся отдельным reference calculation:

```text
F0 = 1 Н поперёк вершины
self weight = 0
wind = 0
ice = 0
equipment = 0
```

Он даёт:

```text
Flim = min(Fmember, Fglobal, Fbolt)
mideal = Flim/g0
```

`mideal` — полезный чистый upper/reference bound, но не расчёт реальной горизонтальной стрелы, потому что собственный вес самой стрелы здесь специально исключён.

Подробнее: [`docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md`](docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md).

## Горизонтальная стрела — issue #36

Для вопроса «сколько можно подвесить на конце, если мачту использовать как стрелу» добавлен отдельный `craneBoomCapacity`.

Та же frame-модель мысленно поворачивается горизонтально. Эквивалентно этому вектор собственного веса рёбер поворачивается в горизонтальную плоскость и становится распределённой поперечной нагрузкой:

```text
A = pi*d²/4
qg = rho*A*g*gamma_g
```

Пробный концевой груз:

```text
Pend = m*g*gamma_payload
```

Для каждого направления в секторе 120° выполняется поиск максимальной проходящей массы с условиями:

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= 1
```

Основной результат:

```text
craneBoomCapacity.maximumEndPayloadMassKg
```

В отличие от `Flim/g0`, здесь **учтён поперечный собственный вес арматурных frame members**. Для типового regression case новый предел обязан быть ниже чистого tip-load upper bound.

Пока не включена отдельная fabrication mass гаек/болтов/сварки, а также не моделируются динамика подъёма, рывок, трос, блоки, лебёдка, поворотный узел, усталость и специальные нормы для грузоподъёмных механизмов. Поэтому это инженерная предварительная оценка, а не паспортная SWL крана.

Подробнее: [`docs/CRANE_BOOM_CAPACITY.md`](docs/CRANE_BOOM_CAPACITY.md).

## Расчётное ядро

Каждый узел имеет 6 DOF:

```text
ux, uy, uz, rx, ry, rz
```

Каждое ребро — spatial Euler–Bernoulli frame element. После решения восстанавливаются:

```text
N, Vy, Vz, T, My, Mz
```

Одна и та же статическая задача проверяется тремя независимыми путями:

1. global symmetric-band FEM;
2. exact module Schur condensation;
3. independent dense reference FEM + Gaussian elimination.

CI сравнивает DOF, reactions и local end forces. Internal point-load fixtures для cross-check проходят через `topPointLoadN`, а не через удалённые пользовательские extra-force fields.

## Соединительный узел

Физический стык:

```text
2 ребра ножки -> проходная гайка My
                    |
                    | болт Mx проходит свободно
                    v
4 ребра узла  -> длинная соединительная гайка Mx
                    ^
                    | болт Mx ввинчивается сюда
```

Auto-конфигуратор выбирает и затем фиксирует физический комплект. Усиленные проверки issue #33 включают:

```text
Anut,net/Arib >= 2
F0,nom = T/(K*d)
F0,max = (1+Gamma)*F0,nom
Nt,strength = F0,max + Nt,external
Ns,direct = |Fperp|
Aeff,weld >= kweld*Arib, 2 <= kweld <= 3
```

Тот же зафиксированный узел используется при operational cases, lateral/static limits, horizontal boom и поиске максимальной высоты.

Подробнее:

- [`docs/JOINT_CONFIGURATOR.md`](docs/JOINT_CONFIGURATOR.md)
- [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md)
- [`docs/JOINT_STRENGTH_AND_VISUALIZATION.md`](docs/JOINT_STRENGTH_AND_VISUALIZATION.md)

## Масса физической сборки

Отдельно показываются:

- масса одного ребра;
- масса полного межмодульного узла;
- масса сваренного и закреплённого модуля;
- оценка массы всей изготовленной мачты.

Fabrication mass пока не возвращается автоматически в FEM self-weight: требуемая длина сварки становится известна после FEM и создаёт feedback `усилия -> шов -> масса -> усилия`. По той же причине horizontal-boom model пока включает собственный вес арматурных members, но не отдельную массу hardware/weld deposit.

## Справочники и верификация

Reference tables строятся из тех же JavaScript-каталогов, которые использует расчёт. Паспорт верификации включает geometry/mass checks, global equilibrium, `K*u-F`, аналитические frame задачи, global↔Schur, independent dense FEM, support statics и eigen residual.

Внешний FEM, инженерная рецензия и натурные испытания остаются **НЕ ПРОВЕРЕНО**, пока реально не выполнены.

## CI/CD

Основные обязательные checks:

```text
Syntax, policy and maintainability
Secrets scan
Triple FEM equivalence
Joint configurator
Joint strength and visualization
Support reaction statics
Usage scenarios and reference catalogs
Static loads, crane boom and cut range
Tests Ubuntu/macOS/Windows
Static site smoke test
```

Focused issue #36 suite:

```bash
npm run test:issue36
```

Проверяет `1…48`, удаление extra-force semantics, internal point-load API, top-mass reserve, отсутствие water-specific result, horizontal-boom self weight/end payload и CI policy.

## Основная документация

- [`docs/USAGE_SCENARIOS.md`](docs/USAGE_SCENARIOS.md)
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)
- [`docs/CALCULATION_ARCHITECTURE.md`](docs/CALCULATION_ARCHITECTURE.md)
- [`docs/ISSUE_36_STATIC_LOAD_SIMPLIFICATION.md`](docs/ISSUE_36_STATIC_LOAD_SIMPLIFICATION.md)
- [`docs/STATIC_PAYLOAD_CAPACITY.md`](docs/STATIC_PAYLOAD_CAPACITY.md)
- [`docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md`](docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md)
- [`docs/CRANE_BOOM_CAPACITY.md`](docs/CRANE_BOOM_CAPACITY.md)
- [`docs/MODULAR_ANALYSIS_AND_HEIGHT.md`](docs/MODULAR_ANALYSIS_AND_HEIGHT.md)
- [`docs/TRIPLE_SOLVER_VERIFICATION.md`](docs/TRIPLE_SOLVER_VERIFICATION.md)
- [`docs/VERIFICATION_FOR_NON_SPECIALISTS.md`](docs/VERIFICATION_FOR_NON_SPECIALISTS.md)

## Ограничения

Прототип не является нормативным сертификатом. Остаются, в частности, P-Delta/geometric nonlinearity, initial imperfections/plasticity, finite joint/foundation stiffness, thread stripping/bearing/prying/slip, fatigue, exact weld geometry, согласованное включение fabrication mass в self-weight, полный набор нормативных сочетаний и независимая внешняя FEM/натурная проверка.

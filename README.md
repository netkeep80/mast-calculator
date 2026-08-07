# Калькулятор мачты

Статическое браузерное приложение для расчёта модульной мачты из сварных арматурных октаэдров. Backend не требуется: тяжёлые вычисления выполняются в Web Worker, публикация — через GitHub Pages.

Опубликованная версия: **https://netkeep80.github.io/mast-calculator/**

## Прототип 1.5 — расчёты отдельно, 3D и КД отдельно

Issue #47 разделяет два разных жизненных цикла проекта.

**Калькулятор** отвечает за исходные данные, FEM, нагрузки, соединения, пределы, подбор, верификацию и бумажный **расчётный проект**.

**Модуль 3D и конструкторской документации** (`design.html`) получает уже рассчитанную конструкцию и отвечает за:

- подробный интерактивный просмотр всей мачты;
- просмотр межмодульного узла;
- экспорт Wavefront OBJ;
- переносимый JSON package принятой конструкции;
- отдельный комплект КД по ЕСКД.

После расчёта в основном интерфейсе появляется кнопка **«Открыть 3D и КД»**. Старый прямой OBJ-экспорт из расчётного экрана убран из фокуса. Бумажный расчётный проект больше не содержит листов ЕСКД.

Между подсистемами используется компактная схема:

```text
mast-calculator/design-package/v1
```

Она переносит геометрию FEM-модели, фактические диаметры рёбер, выбранный физический соединительный узел и производственную массу, но не копирует тяжёлые эксплуатационные load cases и не запускает второй FEM.

КД обновлена до:

```text
mast-calculator/eskd-construction-documentation/v2
mast-calculator/technical-projection/v1
```

Виды мачты и модуля теперь автоматически строятся из той же `detailed-mast-model`, что используется интерактивным 3D viewer и OBJ. Старая ручная SVG-схема больше не является источником чертежной геометрии.

Подробнее:

- [`docs/DESIGN_WORKSPACE.md`](docs/DESIGN_WORKSPACE.md)
- [`docs/ESKD_CONSTRUCTION_DOCUMENTATION.md`](docs/ESKD_CONSTRUCTION_DOCUMENTATION.md)
- [`docs/INTEGRATED_3D_VIEWER.md`](docs/INTEGRATED_3D_VIEWER.md)
- [`docs/3D_MODEL_EXPORT.md`](docs/3D_MODEL_EXPORT.md)

## Практические сценарии расчёта

Пользователь начинает с одного из четырёх вопросов:

1. **Проверить конкретную мачту** — выдержит ли конструкция заданную погоду и установленное оборудование;
2. **Подобрать конструкцию** — минимальный проходящий диаметр арматуры и согласованный физический узел;
3. **Узнать пределы** — максимальная высота, максимальная масса на вершине, сколько ещё килограммов можно добавить и какой концевой груз выдержит та же конструкция как горизонтальная стрела;
4. **Проверить расчёт** — алгоритм, residuals, global/Schur/dense cross-check, паспорт верификации и справочники.

Главное правило issue #36: одна физическая нагрузка не должна задаваться двумя способами. Из пользовательской модели удалены произвольные `extraHorizontalLoadN` и `extraVerticalLoadN`. Вертикальная нагрузка вершины задаётся одной понятной величиной — **массой оборудования/груза в килограммах**.

Внутренние известные силы для analytical tests и normalized capacity cases передаются через `topPointLoadN` и не являются пользовательскими параметрами.

Подробнее: [`docs/ISSUE_36_STATIC_LOAD_SIMPLIFICATION.md`](docs/ISSUE_36_STATIC_LOAD_SIMPLIFICATION.md).

## Раскрой арматуры

Закупочный пруток можно делить на любое целое число одинаковых частей:

```text
1, 2, 3, …, 48
```

До учёта ширины реза и технологических припусков:

```text
a = Lstock / nparts
```

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

Три нижних production nodes пока имеют идеальную жёсткую заделку по шести DOF. Отдельные аналитические tests с шарнирными точечными опорами являются verification fixtures.

## Эксплуатационные нагрузки

Production load layer использует:

- собственный вес арматурных рёбер;
- ветер;
- лёд;
- массу оборудования/груза на вершине;
- парусную площадь оборудования.

Legacy `extraHorizontalLoadN` и `extraVerticalLoadN`, даже если встретятся в старом объекте параметров, больше не изменяют production load case.

## Максимальная масса на вершине вертикальной мачты

Gravity-only задача возвращает:

```text
maximumTopEquipmentMassKg
additionalTopEquipmentMassKg
```

Проверяются:

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= 1
```

Собственный вес мачты сохраняется; ветер и лёд выключены. Подробнее: [`docs/STATIC_PAYLOAD_CAPACITY.md`](docs/STATIC_PAYLOAD_CAPACITY.md).

## Чистый поперечный unit-load

Reference calculation:

```text
F0 = 1 Н поперёк вершины
self weight = 0
wind = 0
ice = 0
equipment = 0
```

Он даёт отдельный чистый upper/reference bound и не подменяет расчёт горизонтальной стрелы. При преднатянутом болте масштабируется только внешняя нагрузка; постоянный `F0,max` от затяжки не умножается вместе с unit-load.

Подробнее: [`docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md`](docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md).

## Горизонтальная стрела

`craneBoomCapacity` поворачивает ту же frame-модель горизонтально. Собственный вес рёбер становится распределённой поперечной нагрузкой, а на конец прикладывается пробный груз:

```text
qg = rho*A*g*gamma_g
Pend = m*g*gamma_payload
```

Для каждого направления проверяются:

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= 1
```

Основной результат:

```text
craneBoomCapacity.maximumEndPayloadMassKg
```

Пока не включена отдельная fabrication mass гаек/болтов/сварки и не моделируются динамика подъёма, трос, блоки, лебёдка, поворотный узел и специальные crane-code factors. Подробнее: [`docs/CRANE_BOOM_CAPACITY.md`](docs/CRANE_BOOM_CAPACITY.md).

## Расчётное ядро

Каждый узел имеет 6 DOF:

```text
ux, uy, uz, rx, ry, rz
```

Каждое ребро — spatial Euler–Bernoulli frame element. После решения восстанавливаются:

```text
N, Vy, Vz, T, My, Mz
```

Одна и та же статическая задача проверяется тремя путями:

1. global symmetric-band FEM;
2. exact module Schur condensation;
3. independent dense reference FEM + Gaussian elimination.

CI сравнивает DOF, reactions и local end forces.

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

Auto-конфигуратор выбирает и фиксирует физический комплект. Усиленные проверки включают:

```text
Anut,net/Arib >= 2
F0,nom = T/(K*d)
F0,max = (1+Gamma)*F0,nom
Nt,strength = F0,max + Nt,external
Ns,direct = |Fperp|
Aeff,weld >= kweld*Arib
```

Тот же узел используется в operational cases, lateral/static limits, horizontal boom, height search, detailed 3D и КД.

Подробнее:

- [`docs/JOINT_CONFIGURATOR.md`](docs/JOINT_CONFIGURATOR.md)
- [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md)
- [`docs/JOINT_STRENGTH_AND_VISUALIZATION.md`](docs/JOINT_STRENGTH_AND_VISUALIZATION.md)

## Подробная 3D-модель

Общий источник geometry:

```text
mast-calculator/detailed-mast-model/v1
```

Он строит polygon mesh:

- каждого арматурного ребра с фактическим диаметром member;
- длинных и проходных гаек;
- болтов и головок;
- ownership по физическим модулям.

Эта модель используется основным `MastViewer`, отдельным design workspace и OBJ exporter. Design workspace не создаёт вторую геометрическую модель мачты.

## Масса физической сборки

Отдельно показываются:

- масса одного ребра;
- масса полного межмодульного узла;
- масса сваренного и закреплённого модуля;
- оценка массы всей изготовленной мачты.

Fabrication mass пока не возвращается автоматически в FEM self-weight: требуемая длина сварки становится известна после FEM и создаёт feedback `усилия -> шов -> масса -> усилия`.

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
Design workspace / ESKD / OBJ regression
Tests Ubuntu/macOS/Windows
Static site smoke test
```

Focused suite нового архитектурного слоя:

```bash
npm run test:design
```

## Основная документация

- [`docs/DESIGN_WORKSPACE.md`](docs/DESIGN_WORKSPACE.md)
- [`docs/ESKD_CONSTRUCTION_DOCUMENTATION.md`](docs/ESKD_CONSTRUCTION_DOCUMENTATION.md)
- [`docs/USAGE_SCENARIOS.md`](docs/USAGE_SCENARIOS.md)
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)
- [`docs/CALCULATION_ARCHITECTURE.md`](docs/CALCULATION_ARCHITECTURE.md)
- [`docs/STATIC_PAYLOAD_CAPACITY.md`](docs/STATIC_PAYLOAD_CAPACITY.md)
- [`docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md`](docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md)
- [`docs/CRANE_BOOM_CAPACITY.md`](docs/CRANE_BOOM_CAPACITY.md)
- [`docs/MODULAR_ANALYSIS_AND_HEIGHT.md`](docs/MODULAR_ANALYSIS_AND_HEIGHT.md)
- [`docs/TRIPLE_SOLVER_VERIFICATION.md`](docs/TRIPLE_SOLVER_VERIFICATION.md)
- [`docs/VERIFICATION_FOR_NON_SPECIALISTS.md`](docs/VERIFICATION_FOR_NON_SPECIALISTS.md)

## Ограничения

Прототип не является нормативным сертификатом. Остаются, в частности, P-Delta/geometric nonlinearity, initial imperfections/plasticity, finite joint/foundation stiffness, thread stripping/bearing/prying/slip, fatigue, exact weld geometry, согласованное включение fabrication mass в self-weight, полный набор нормативных сочетаний и независимая внешняя FEM/натурная проверка.

# Максимальная масса оборудования/груза на вершине

Расчёт отвечает на один практический вопрос: **какую суммарную массу можно разместить на верхней треугольной грани вертикальной мачты и сколько килограммов ещё остаётся до первого расчётного предела**.

Issue #36 намеренно убирает второй способ задания той же физики через произвольную «дополнительную вертикальную силу». В пользовательской модели остаётся одна величина — масса оборудования/груза на вершине.

## Что именно считается

Специальный case является gravity-only:

```text
включено:
  собственный вес арматурного каркаса
  искомая суммарная масса оборудования/груза на вершине
  проверка выбранного межмодульного болта

исключено:
  ветер
  лёд
```

Собственный вес не обнуляется. Искомая масса прикладывается вертикально вниз поровну между тремя верхними nodes.

## Пользовательский смысл результата

Основные величины:

```text
maximumTopEquipmentMassKg
  максимальная суммарная масса на верхней грани

configuredTopEquipmentMassKg
  масса, уже введённая пользователем как установленное оборудование/груз

additionalTopEquipmentMassKg
  сколько ещё килограммов можно добавить до первого расчётного предела
```

```text
additionalTopEquipmentMassKg = max(
  0,
  maximumTopEquipmentMassKg - configuredTopEquipmentMassKg
)
```

Для совместимости внутренних snapshot/UI предыдущих версий пока сохраняются aliases `maximumTotalTopMassKg`, `configuredEquivalentTopMassKg` и `remainingAdditionalMassKg`, но они больше не включают пересчёт произвольной дополнительной силы.

## Почему больше нет отдельного объёма воды

Эквивалентный объём воды не является самостоятельной расчётной задачей конструкции. Если кому-то нужен такой пересчёт, он непосредственно получается из массы:

```text
V = m / rho
```

Поэтому issue #36 удаляет `equivalentWaterVolumeM3`, `equivalentWaterVolumeLiters` и `waterDensityKgM3` из результата статической грузоподъёмности и из пользовательского интерфейса. Это уменьшает число метрик без потери конструктивной информации.

## Коэффициенты

```text
gamma_g = deadLoadFactor
gamma_payload = equipmentLoadFactor
```

Для nominal mass `m`:

```text
Pnom = m*g
Pdesign = m*g*gamma_payload
g = 9.80665 m/s²
```

UI показывает nominal mass в kg; проверки выполняются с расчётными коэффициентами.

## Почему нельзя просто масштабировать 1 кг

Без self weight линейная модель даёт reference-пределы:

```text
m_member,pure = 1/U_member(1 kg)
m_bolt,pure   = 1/U_bolt(1 kg)
m_global,pure = lambda_cr(1 kg)
m_pure = min(m_member,pure, m_bolt,pure, m_global,pure)
```

Но реальная мачта уже нагружена собственным весом, поэтому `m_pure` используется только как upper bound.

Финальная задача для каждого trial `m` заново строит load vector/member actions/`KG` и проверяет:

```text
U_member(m) <= 1
U_bolt(m) <= 1
lambda_cr(m) >= 1
```

`U_bolt(m)` вычисляется из coincident end actions того же gravity load case. Подробности physical split и формул: [`CONNECTIONS.md`](CONNECTIONS.md).

Global buckling остаётся:

```text
(K + lambda*KG(m))*phi = 0
```

`lambda_cr=1` соответствует достижению критического состояния для фактически приложенной комбинации self weight + payload.

## Поиск предела

Алгоритм:

1. считает pure 1 kg без self weight и получает верхнюю границу по member/bolt/global criteria;
2. проверяет конструкцию только под self weight;
3. проверяет upper bound вместе с self weight;
4. выполняет 18 итераций binary search;
5. сохраняет последнюю проходящую массу как безопасную сторону найденного предела.

Матрица упругой жёсткости `K` собирается/factorized один раз. На итерациях меняются load vector, member actions, `KG` и bolt demand.

## Определяющий механизм

На каждом шаге:

```text
U_member = max(U_vonMises, U_Euler)
U_global = 1/lambda_cr
U_bolt   = bolt combined utilization
U_total  = max(U_member, U_global, U_bolt)
```

Предел достигается при:

```text
U_total = 1
```

Governing mode:

```text
material-strength
local-member-buckling
global-buckling
bolt-connection
self-weight-overlimit
```

## Отдельная горизонтальная стрела

Вертикальную массу вершины нельзя смешивать с поперечной работой той же конструкции. Issue #36 поэтому содержит две отдельные поперечные задачи:

1. [`LATERAL_CAPACITY_WEATHER_VALIDATION.md`](LATERAL_CAPACITY_WEATHER_VALIDATION.md) — чистый `1 Н` unit-load без собственного веса, нужен как verification/reference upper bound;
2. [`CRANE_BOOM_CAPACITY.md`](CRANE_BOOM_CAPACITY.md) — горизонтальная стрела, где собственный вес арматурных members повёрнут в поперечное направление и вместе с концевым грузом расходует несущую способность.

Основной результат второго расчёта:

```text
craneBoomCapacity.maximumEndPayloadMassKg
```

Он содержательнее простого `Flateral/g`, потому что уже учитывает изгиб от собственного веса горизонтально ориентированной арматурной стрелы. При этом он всё ещё не является паспортной SWL: пока нет динамики подъёма, троса/лебёдки, шарнира, специальных crane-code factors и fabrication mass hardware/weld в FEM.

## Что вертикальный результат не учитывает

`maximumTopEquipmentMassKg` нельзя трактовать как готовую нормативную грузоподъёмность сооружения.

Не учтены:

- eccentricity центра тяжести верхнего груза;
- динамика/удар при подвешивании груза;
- P-Delta/geometric nonlinearity;
- initial imperfections;
- finite stiffness реального стыка;
- thread stripping/bearing/prying/slip соединения;
- exact weld group geometry;
- foundation;
- нормативные load combinations.

## Regression checks

Тесты проверяют:

- finite/positive maximum mass;
- self weight в special case;
- safe side binary search;
- `U_member<=1`, `U_bolt<=1`, `lambda_cr>=1` на сохранённом пределе;
- вычет только уже заданной массы оборудования;
- отсутствие water-specific полей результата;
- отсутствие влияния legacy `extraVerticalLoadN`;
- независимость gravity-only результата от wind/ice;
- рост payload capacity с увеличением rebar diameter;
- progress до 100%.

Отдельный `tests/crane-boom-capacity.test.js` проверяет горизонтальную стрелу и её собственный вес.

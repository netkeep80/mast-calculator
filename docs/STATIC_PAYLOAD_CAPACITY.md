# Максимальная статическая нагрузка на вершине

Расчёт из issue #11 оценивает, какую **суммарную массу груза на верхней треугольной грани** может нести мачта. Начиная с прототипа 1.0 этот предел учитывает не только frame members и global buckling, но и выбранный межмодульный болт.

## Что именно считается

Специальный case является gravity-only:

```text
включено:
  собственный вес арматурного каркаса
  искомая вертикальная масса на вершине
  проверка выбранного межмодульного болта

исключено:
  ветер
  лёд
  горизонтальные силы
  дополнительные нагрузки обычного погодного case
```

Собственный вес не обнуляется. Искомая масса прикладывается вертикально вниз поровну между тремя верхними nodes.

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

Без self weight линейная модель даёт чистые reference-пределы:

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

`U_bolt(m)` вычисляется из coincident end actions того же gravity load case: на каждом внутреннем стыке два upward members формируют один bolt demand. Подробности physical split и формул: [`CONNECTIONS.md`](CONNECTIONS.md).

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

Результат дополнительно хранит:

```text
boltUtilizationAtLimit
baseBoltUtilization
purePayloadReference.boltLimitKg
```

## Уже установленное оборудование

`maximumTotalTopMassKg` — maximum total equivalent mass at top.

Существующая vertical load переводится в mass:

```text
m_existing = equipmentMassKg
           + extraVerticalLoadN/(g*equipmentLoadFactor)
```

Remaining reserve:

```text
m_remaining = max(0, m_max - m_existing)
```

## Эквивалентный объём воды

```text
rho_water = 1000 kg/m³
Vwater = m_remaining/rho_water
```

UI показывает kg, m³ и liters. Масса самого бака должна входить в `equipmentMassKg` либо вычитаться отдельно.

## Что результат не учитывает

`maximumTotalTopMassKg` нельзя трактовать как готовую паспортную грузоподъёмность водонапорной башни.

Не учтены:

- wind area/moment самого бака;
- eccentricity центра тяжести;
- sloshing/dynamic water effects;
- P-Delta/geometric nonlinearity;
- initial imperfections;
- finite stiffness реального стыка;
- thread stripping/bearing/prying/slip соединения;
- exact weld group geometry;
- foundation;
- нормативные load combinations.

**Сам выбранный межмодульный болт на tension/shear/combined action уже входит в предел 1.0.** Остальные механизмы реального узла требуют дополнительных размеров и перечислены в [`CONNECTIONS.md`](CONNECTIONS.md).

## Regression checks

Тесты проверяют:

- finite/positive maximum mass;
- self weight в special case;
- safe side binary search;
- `U_member<=1`, `U_bolt<=1`, `lambda_cr>=1` на сохранённом пределе;
- правильный вычет existing vertical load;
- conversion mass -> water volume;
- независимость gravity-only результата от wind/ice;
- рост payload capacity с увеличением rebar diameter;
- рост bolt reference limit при усилении bolt specification;
- finite `boltUtilizationAtLimit` в 40-module regression;
- progress до 100%.

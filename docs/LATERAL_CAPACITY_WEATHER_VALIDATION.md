# Боковая нагрузка, погодные сценарии и solid-rod sanity-check

Статус: спецификация и верификация прототипа **1.4**.

## 1. Назначение отдельной боковой проверки

Обычный wind calculation распределяет давление по всем рёбрам и оборудованию. Для натурного контрольного опыта и оценки поперечной несущей способности удобнее приложить известную горизонтальную силу к вершине мачты.

Этот special case не смешивается с эксплуатационной ветровой огибающей.

Он определяет первый из трёх пределов:

1. material strength / local member buckling;
2. global eigen-buckling frame-модели;
3. выбранный межмодульный болт.

Issue #36 дополнительно даёт этому числу понятную практическую интерпретацию:

```text
m_crane,ideal = Flim / g
```

То есть `idealizedCraneBoomPayloadKg` — эквивалентная масса концевого груза, создающего такую же поперечную силу. Это полезная оценка конструкции как **идеализированной консольной стрелы**, но не паспортная грузоподъёмность крана.

## 2. Нормированный расчёт 1 Н

На верхнюю треугольную грань прикладывается внутренняя test-fixture нагрузка:

```text
F0 = 1 Н horizontal
```

Сила делится поровну между тремя top nodes.

Issue #36 отделяет эту силу от пользовательских параметров: она передаётся в `buildLoadCase(..., { topPointLoadN })`, а не через поля «дополнительная горизонтальная сила» формы.

Отключаются:

```text
wind
ice
self weight
equipment
```

В линейной frame-модели actions/displacements масштабируются с внешней силой.

Member limit:

```text
Fmember = 1/U_member(F0)
```

Global limit при физически значимом осевом сжатии:

```text
Fglobal = lambda_cr(F0)*1 Н
```

Connection layer для каждого внутреннего node собирает два upward member и вычисляет unit bolt utilization:

```text
Ubolt(F0)
Fbolt = 1/Ubolt(F0)
```

Итог:

```text
Flim = min(Fmember, Fglobal, Fbolt)
```

Governing mode:

```text
material-strength
local-member-buckling
global-buckling
bolt-connection
```

## 3. Что именно означает «стрела крана»

Для конструкции, повернутой горизонтально, вес подвешенного на конце груза действует поперёк продольной оси. Поэтому преобразование `Flim/g` даёт полезный эквивалент массы такого концевого груза.

Но текущий нормированный lateral case **специально исключает собственный вес**. Следовательно, он не учитывает поперечное действие веса самой горизонтально ориентированной стрелы, динамику подъёма, рывок, тросовую геометрию, шарнир/опору стрелы и нормативные коэффициенты подъёмного сооружения.

Поэтому в UI формулировка должна оставаться явной:

```text
идеализированная консольная стрела
```

а не «разрешённая грузоподъёмность крана».

## 4. Фильтр machine-noise для global buckling

`KG` зависит от предварительных axial actions. У идеально прямой solid cantilever под чистой transverse load осевое сжатие теоретически равно нулю.

Поэтому global eigen-buckling бокового special case учитывается только если максимальное сжатие превышает:

```text
1e-9 Н
```

Это исключает ложный finite eigenvalue из rounding noise и не отключает реальный решётчатый buckling мачты.

## 5. Направления

Треугольная мачта периодична через 120°:

```text
0 <= alpha < 120°
```

Default step `15°`; шаг настраивается.

Отдельно сохраняются governing directions для member/global/bolt/overall limits.

## 6. Н/кН/кгс и эквивалент массы

Core хранит N. Для силы:

```text
1 кгс = 9.80665 Н
F_kgf = F_N/9.80665
```

Численно значение в `кгс` совпадает с массой в kg, вес которой при стандартном `g0` создаёт эту силу:

```text
idealizedCraneBoomPayloadKg = criticalForceN / 9.80665
```

Единицы при этом различны: `кгс` — сила, `кг` — масса.

## 7. Погодные сценарии

Weather dropdown использует Beaufort 0–12 и отдельный custom pressure mode.

Для preset:

```text
q = rho*v²/2
rho = 1.225 kg/m³
```

Beaufort 12 в текущем preset начинается с 33 m/s. Это сравнительный сценарий, не replacement для СП 20, height factors, gust/pulsation и нормативных combinations.

## 8. Solid-rod sanity-check

Искусственный case:

```text
d_rib = a/2
D_solid = 2a/sqrt(3)
A6/Asolid = 9/8 = 1.125
```

После появления bolt check sanity сравнивает именно frame/member capacity:

```text
P_mast = mast.memberLimitForceN
P_solid = solid.memberLimitForceN
```

Regression bands:

```text
0.5 < P_member,mast/P_member,solid < 2.5
0.3 < K_mast/K_solid < 3.0
```

Цель — ловить gross scale/unit/stiffness/topology errors, а не добиваться равенства разных конструкций.

## 9. Аналитическая проверка unit lateral algorithm

Для круглой консоли `L,d` под tip load `P`:

```text
A = pi*d²/4
W = pi*d³/32
sigma_M = P*L/W
tau_V = 4P/(3A)
sigma_eq = sqrt((P*L/W)² + 3*(4P/(3A))²)
```

При `sigma_eq=Ryd`:

```text
P_y = Ryd / sqrt((L/W)² + 3*(4/(3A))²)
```

Нормированный `1 Н` algorithm должен воспроизводить эту величину.

## 10. Connection regression для бокового case

Требуется:

- `Fbolt` finite для multi-module mast;
- one-module model не выдумывает internal bolt;
- увеличение bolt diameter/property class повышает `Fbolt`;
- `Flim` может иметь mode `bolt-connection`;
- bolt unit utilization строится из coincident actions одного direction case;
- `idealizedCraneBoomPayloadKg === criticalForceKgf` численно при стандартном `g0`.

## 11. Практическая натурная проверка

Безопасный первый этап — controlled load-deflection series. Полезно фиксировать applied lateral force, direction, top displacement, residual displacement after unloading и состояние weld/bolt/nut.

Переход к destructive test требует отдельной программы безопасности и не должен следовать напрямую из числа `Flim`.

## 12. Граница интерпретации

`Fmember`, `Fglobal`, `Fbolt`, `Flim` и `idealizedCraneBoomPayloadKg` относятся к текущей idealized model.

Реальная крановая эксплуатация требует отдельного расчёта собственного веса горизонтальной стрелы, динамики, узла опирания/поворота, троса, усталости и нормативных коэффициентов.

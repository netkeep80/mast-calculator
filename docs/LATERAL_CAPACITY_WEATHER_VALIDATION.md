# Боковая нагрузка, погодные сценарии и solid-rod sanity-check

Статус: спецификация и верификация прототипа 1.0.

## 1. Назначение отдельной боковой проверки

Обычный wind calculation распределяет давление по всем рёбрам и оборудованию. Для натурного контрольного опыта удобнее приложить известную горизонтальную силу к вершине мачты.

Этот special case не смешивается с эксплуатационной ветровой огибающей.

В версии 1.0 он определяет первый из трёх пределов:

1. material strength / local member buckling;
2. global eigen-buckling frame-модели;
3. выбранный межмодульный болт.

Это не допустимая рабочая грузоподъёмность крана.

## 2. Нормированный расчёт 1 Н

На верхнюю треугольную грань прикладывается:

```text
F0 = 1 Н horizontal
```

Сила делится поровну между тремя top nodes.

Отключаются:

```text
wind
ice
self weight
equipment
extra user loads
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

Подробный bolt demand/capacity: [`CONNECTIONS.md`](CONNECTIONS.md).

## 3. Фильтр machine-noise для global buckling

`KG` зависит от предварительных axial actions. У идеально прямой solid cantilever под чистой transverse load осевое сжатие теоретически равно нулю.

Поэтому global eigen-buckling бокового special case учитывается только если максимальное сжатие превышает:

```text
1e-9 Н
```

Это исключает ложный finite eigenvalue из rounding noise и не отключает реальный решётчатый buckling мачты.

## 4. Направления

Треугольная мачта периодична через 120°:

```text
0 <= alpha < 120°
```

Default step `15°`; шаг настраивается.

Отдельно сохраняются governing directions для:

```text
member limit
global buckling limit
bolt limit
first overall limit
```

## 5. Н/кН/кгс

Core хранит N. UI также выводит kgf:

```text
1 кгс = 9.80665 Н
F_kgf = F_N/9.80665
```

В UI используется `кгс`, а не `кг`.

## 6. Погодные сценарии

Weather dropdown использует Beaufort 0–12 и отдельный custom pressure mode.

Источник характерных скоростей: Met Office Beaufort wind force scale.

Для preset:

```text
q = rho*v²/2
rho = 1.225 kg/m³
```

Beaufort 12 в текущем preset начинается с 33 m/s.

Это сравнительный сценарий, не replacement для СП 20, height factors, gust/pulsation и нормативных combinations.

## 7. Solid-rod sanity-check

### 7.1. Геометрия

Предельный искусственный case:

```text
d_rib = a/2
D_solid = 2a/sqrt(3)
```

Площадь шести рёбер:

```text
A6 = 6*pi*(a/2)²/4
```

Площадь solid circular cantilever:

```text
Asolid = pi*(2a/sqrt(3))²/4
```

Инвариант:

```text
A6/Asolid = 9/8 = 1.125
```

### 7.2. Почему с версии 1.0 sanity сравнивает member limit

После появления реального bolt check общий lateral limit стал:

```text
criticalForceN = min(member, global, bolt)
```

В искусственной геометрии `d_rib=a/2` рёбра имеют диаметр 150 мм, а default bolt остаётся M24. Такой болт закономерно становится на порядки слабее frame и уничтожает исходный смысл sanity-check.

Поэтому regression теперь сравнивает **frame/member capacity**:

```text
P_mast = mast.memberLimitForceN
P_solid = solid.memberLimitForceN
```

а не overall `criticalForceN`.

Это не обход bolt check: отдельные connection tests специально проверяют `Fbolt`, его monotonic growth с диаметром/классом и включение в реальный overall lateral limit.

### 7.3. Regression bands

Для специальной модели:

```text
a = 300 mm
d_rib = 150 mm
4 modules
```

проверяются:

```text
0.5 < P_member,mast/P_member,solid < 2.5
0.3 < K_mast/K_solid < 3.0
```

Цель — ловить gross scale/unit/stiffness/topology errors, а не добиваться равенства разных конструкций.

## 8. Аналитическая проверка unit lateral algorithm

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

Также остаются classical checks:

```text
delta = P*L³/(3EI)
theta = P*L²/(2EI)
```

## 9. Connection regression для бокового case

Прототип 1.0 дополнительно требует:

- `Fbolt` finite для multi-module mast;
- one-module model не выдумывает internal bolt;
- увеличение bolt diameter/property class повышает `Fbolt`;
- `Flim` может иметь mode `bolt-connection`;
- bolt unit utilization строится из coincident actions одного direction case.

## 10. Практическая натурная проверка

Безопасный первый этап — не разрушение, а controlled load-deflection series. Полезно фиксировать:

- applied lateral force;
- direction;
- top displacement;
- residual displacement after unloading;
- local deformation/damage of joints;
- состояние weld/bolt/nut/washer.

Переход к destructive test требует отдельной программы безопасности и не должен следовать напрямую из числа `Flim`.

## 11. Граница интерпретации

`Fmember`, `Fglobal`, `Fbolt`, `Flim` относятся к текущей idealized model.

`Fbolt` уже учитывает нормативные tension/shear capacities выбранного болта и явный `jointEffectiveRadiusMm`, но ещё не включает thread stripping, bearing, prying, slip и finite joint stiffness. Эти ограничения описаны в [`CONNECTIONS.md`](CONNECTIONS.md).

# Боковая unit-load проверка, погода и solid-rod sanity-check

Статус: спецификация и верификация прототипа **1.4**.

## 1. Назначение

Обычный эксплуатационный wind case распределяет давление по всем рёбрам и оборудованию. Для проверки самого frame/connection response существует отдельная нормированная задача с известной горизонтальной силой на вершине.

Это **reference/validation case**, а не расчёт горизонтальной стрелы с собственным весом. Полноценный special case issue #36 описан отдельно: [`CRANE_BOOM_CAPACITY.md`](CRANE_BOOM_CAPACITY.md).

## 2. Нормированный расчёт 1 Н

На верхнюю треугольную грань через внутренний test-fixture API прикладывается:

```text
F0 = 1 Н horizontal
```

Сила делится поровну между тремя top nodes:

```text
buildLoadCase(model, parameters, {
  topPointLoadN: [Fx,Fy,0]
})
```

Отключаются:

```text
wind
ice
self weight
equipment
```

Issue #36 принципиально не использует для этого пользовательские `extraHorizontalLoadN`/`extraVerticalLoadN`.

## 3. Пределы

Для линейной frame-модели:

```text
Fmember = 1/Umember(1 Н)
Fglobal = lambda_cr(1 Н)*1 Н
Fbolt = 1/Ubolt(1 Н)
Flim = min(Fmember,Fglobal,Fbolt)
```

Governing mode:

```text
material-strength
local-member-buckling
global-buckling
bolt-connection
```

Независимо сохраняются governing directions для member/global/bolt/overall limits.

## 4. Численный эквивалент массы

Для удобства comparison:

```text
1 кгс = 9.80665 Н
mideal = Flim/9.80665
```

`mideal` численно равно массе, вес которой при стандартном `g0` создаёт такую силу. В API сохранено compatibility имя:

```text
idealizedCraneBoomPayloadKg
```

Но после issue #36 это **не основной crane-boom result**. Оно остаётся pure-tip upper/reference bound, потому что собственный вес горизонтально ориентированной стрелы здесь равен нулю по определению test case.

Основной результат стрелы:

```text
result.craneBoomCapacity.maximumEndPayloadMassKg
```

Он отдельно учитывает поперечный self weight арматурных members.

## 5. Фильтр machine-noise для global buckling

У идеально прямой solid cantilever под чистой transverse load осевое сжатие теоретически равно нулю. Поэтому global eigen-buckling учитывается только при значимом compression:

```text
Ncompression > 1e-9 Н
```

Это отсекает rounding noise и не отключает реальный lattice buckling мачты.

## 6. Направления

Из-за 120° rotational symmetry достаточно:

```text
0 <= alpha < 120°
```

Default step `15°`; пользовательский параметр допускает более грубую сетку.

## 7. Погодные сценарии

Weather dropdown использует Beaufort 0–12 и custom pressure mode.

Для preset:

```text
q = rho*v²/2
rho = 1.225 kg/m³
```

Шкала Бофорта здесь является сравнительным способом ввода, а не заменой нормативному wind zoning/height/gust/combinations.

## 8. Solid-rod sanity-check

Искусственный case:

```text
d_rib = a/2
D_solid = 2a/sqrt(3)
A6/Asolid = 9/8 = 1.125
```

Сравнивается порядок member capacity и lateral stiffness:

```text
0.5 < Pmember,mast/Pmember,solid < 2.5
0.3 < Kmast/Ksolid < 3.0
```

Это sanity-check масштаба/единиц/topology, а не теорема эквивалентности решётки и сплошного стержня.

## 9. Аналитическая проверка круглой консоли

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
Py = Ryd / sqrt((L/W)² + 3*(4/(3A))²)
```

Нормированный algorithm должен воспроизводить эту величину.

## 10. Практическая проверка

Для реальной вертикальной мачты безопаснее начинать с controlled load-deflection series: известная поперечная сила, направление, displacement, residual displacement после разгрузки, состояние weld/bolt/nut.

Destructive test требует отдельной программы безопасности.

## 11. Граница интерпретации

Pure lateral `Flim` не включает self weight, погоду, equipment и динамику. Для вопроса «сколько кг можно подвесить на конце горизонтальной конструкции» следует использовать [`CRANE_BOOM_CAPACITY.md`](CRANE_BOOM_CAPACITY.md), где self weight арматурных members уже действует поперёк стрелы.

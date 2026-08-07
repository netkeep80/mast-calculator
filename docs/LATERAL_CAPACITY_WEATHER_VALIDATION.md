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

Отключаются ветер, лёд, собственный вес и оборудование.

## 3. Пределы и преднатяг болта

Для member/global частей:

```text
Fmember = 1/Umember(1 Н)
Fglobal = lambda_cr(1 Н)*1 Н
```

Для преднатянутого болта `1/Ubolt(1 Н)` неприменимо: так вместе с внешней нагрузкой ошибочно масштабируется постоянный преднатяг.

Пусть:

```text
s = Ns,1/Nbs
t = Nt,1/Nbt
p = F0,max/Nbt
```

Масштабируется только внешняя нагрузка `x`:

```text
(x*s)^2 + (p + x*t)^2 = 1

a = s^2+t^2
b = 2*p*t
c = p^2-1
x = (-b + sqrt(b^2-4*a*c))/(2*a)
Fbolt = x*1 Н
```

Преднатяг `F0,max` остаётся постоянным. При нулевом преднатяге формула естественно сводится к обычному линейному масштабированию.

```text
Flim = min(Fmember,Fglobal,Fbolt)
```

## 4. Численный эквивалент массы

```text
1 кгс = 9.80665 Н
mideal = Flim/9.80665
```

`idealizedCraneBoomPayloadKg` остаётся pure-tip reference upper bound без собственного веса горизонтальной стрелы. Основной результат стрелы — `result.craneBoomCapacity.maximumEndPayloadMassKg`, который учитывает поперечный self weight арматурных members.

## 5. Фильтр machine-noise для global buckling

Global eigen-buckling учитывается только при значимом compression:

```text
Ncompression > 1e-9 Н
```

## 6. Направления

Из-за 120° rotational symmetry достаточно:

```text
0 <= alpha < 120°
```

Default step `15°`.

## 7. Погодные сценарии

Для Beaufort preset:

```text
q = rho*v²/2
rho = 1.225 kg/m³
```

Шкала Бофорта — сравнительный сценарий, не замена нормативному wind zoning/height/gust/combinations.

## 8. Solid-rod sanity-check

```text
d_rib = a/2
D_solid = 2a/sqrt(3)
A6/Asolid = 9/8 = 1.125
```

Сравнивается порядок member capacity и lateral stiffness, а не строгая эквивалентность решётки и сплошного стержня.

## 9. Граница интерпретации

Pure lateral `Flim` не включает self weight, погоду, equipment и динамику. Для вопроса о реальной горизонтальной стреле следует использовать [`CRANE_BOOM_CAPACITY.md`](CRANE_BOOM_CAPACITY.md).

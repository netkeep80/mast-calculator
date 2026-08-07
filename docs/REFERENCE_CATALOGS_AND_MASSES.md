# Справочники и масса физической сборки

Статус: prototype 1.3 с расширением issue #33.

## 1. Цель

Пользователь должен иметь возможность ответить на три вопроса:

1. **Какие исходные численные данные использует программа?**
2. **Какие дополнительные проектные критерии приняты для соединительного узла?**
3. **Сколько примерно весит реальная изготовленная деталь, а не только арматурный FEM-каркас?**

## 2. Принцип единого источника истины

Reference UI не содержит вручную переписанных `Ry`, `Rm`, `Rbt`, `Abn`, размеров гаек или коэффициентов нового connection-layer.

```text
calculation catalogs / connection constants
       │
       ├── solver / configurator / checks
       │
       └── buildReferenceData()
                 │
                 ├── browser tables
                 └── paper project audit
```

Схема после issue #33:

```text
mast-calculator/reference-data/v2
```

## 3. Арматура

Для каждого класса показываются:

```text
Ry, Rm, E, ν, ρ
гарантированная свариваемость
нормативный источник
```

Для диаметров вычисляются:

```text
A = πd²/4
m1m = ρA
```

Масса 1 м вычисляется, а не дублируется как отдельная константа.

## 4. Болты

Прочностной каталог содержит:

```text
Rbun, Rbs, Rbt, Ab, Abn
```

Дополнительно для геометрии/массы показываются `s` и `k` головки. Геометрия головки не участвует в `Nbs/Nbt`.

Оценка массы:

```text
Vshaft = πd²/4·L
Vhead = √3/2·s²·k
mbolt = ρ(Vshaft+Vhead)
```

Резьбовой профиль, фаски и скругления не вычитаются, поэтому это не паспортная масса изделия.

## 5. Гайки

Обычные и длинные гайки берутся из `joint-hardware-catalog.js`.

Для массы и issue #33 используется одна и та же базовая геометрия:

```text
Ahex = √3/2·s²
D1 = D-1.082532P
Anut,net = Ahex-πD1²/4
Vnut = Anut,net·h
mnut = ρVnut
```

Для длинной гайки вместо `h` используется её длина.

### Project criterion issue #33

Reference data явно публикует:

```text
Anut,net/Arib >= 2
```

Это дополнительный геометрический запас проекта. Он не маркируется как нормативная замена thread stripping, bearing, local face bending или prying.

## 6. Torque/preload reference — issue #33

Reference data v2 публикует relation и defaults:

```text
T = K·F0·d
Tdefault = 200 Н·м
Kdefault = 0.20
Gamma_default = 0.25
```

Источник/статус также показывается пользователю. Публичная инженерная основа relation — NASA-STD-5020A Appendix A / NASA Fastener Design Manual. `K` не является универсальной константой: фактическое значение зависит от резьбы, покрытия и смазки.

В расчёте используется:

```text
F0,max=(1+Gamma)·T/(K·d)
```

и эта верхняя граница расходует tensile reserve болта.

## 7. Сварочные материалы и effective area — issue #33

Каталог сварки показывает `Rwun/Rwf`, process, standard и доступные катеты.

Силовой weld-check использует существующие `N/V/T/M`. Дополнительный project criterion:

```text
teff=beta_f·kf
Aeff=teff·lweff
Aeff>=kweld·Arib
2<=kweld<=3
default=2.5
```

Reference data v2 показывает диапазон/default и прямо указывает: `2…3×` — критерий issue #33, а не утверждение о нормативном коэффициенте AISC/СП. Общий принцип effective area = effective throat × effective length согласован с обычным определением effective fillet-weld area.

Для массы наплавленного металла используется другая геометрическая величина:

```text
Adeposit ≈ k²/2
Vweld = Adeposit·Lphysical
mweld = ρVweld
```

`Adeposit` для массы и `Aeff=teff*lweff` для strength/area criterion нельзя смешивать.

## 8. Масса одного ребра

```text
mrib=ρ·πd²/4·a
```

`a` — фактическая расчётная длина из закупочного раскроя.

## 9. Масса полного межмодульного узла

Один physical joint estimate:

```text
1 длинная гайка
1 проходная гайка
1 болт
6 сваренных концов
```

```text
Mjoint=Mbolt+Mclearance+Mcoupling+6·MweldEnd
```

Рёбра в `Mjoint` не включаются.

## 10. Масса модуля

Один унифицированный модуль:

```text
9 рёбер
3 длинные гайки
3 проходные гайки
3 болта
18 сваренных концов
```

```text
Mmodule=9·Mrib
       +3(Mbolt+Mclearance+Mcoupling)
       +18·MweldEnd
```

Для производственной оценки всем 18 концам назначается критическая требуемая физическая длина шва из огибающей. Это консервативная унификация изделия; сумма индивидуальных длин также сохраняется.

## 11. Почему fabrication mass пока отдельно от FEM self-weight

Требуемая длина шва появляется после FEM:

```text
loads → FEM → N/V/T/M → required weld → weld mass
```

Если автоматически вернуть эту массу в тот же solve, появляется feedback:

```text
loads → forces → weld → mass → loads → ...
```

Поэтому сейчас:

```text
FEM self-weight = масса арматурных members
fabrication mass = отдельная производственная оценка
```

Для объединения нужен либо заранее фиксированный конструктивный шов, либо явный iterative convergence workflow.

## 12. Что проверяет CI

`tests/reference-data.test.js` проверяет:

- single-source размеры каталогов;
- ключевые `Ry/Rm/Rbt/Abn/Rwf`;
- schema `reference-data/v2`;
- `T=K·F0·d`, defaults `T/K/Gamma`;
- минимум `2×` для nut net section;
- диапазон/default `2…3×/2.5×` для weld effective area;
- явный ненормативный статус project coefficients.

`tests/assembly-mass.test.js` проверяет `ρπd²/4`, массы метизов/шва, композицию узла/модуля и отделение fabrication mass от global FEM self-weight.

`tests/fabrication-project.test.js` подтверждает, что те же значения и усиленные формулы узла попадают в бумажный проект.

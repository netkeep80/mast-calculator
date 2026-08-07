# Требования к Калькулятору мачты

Статус: актуальная рабочая спецификация прототипа **1.4** после issues #18, #21, #26, #27, #32, #33 и #36.

Специализированные документы:

- [`CALCULATION_ARCHITECTURE.md`](CALCULATION_ARCHITECTURE.md) — FEM и численные пути;
- [`MODULAR_ANALYSIS_AND_HEIGHT.md`](MODULAR_ANALYSIS_AND_HEIGHT.md) — Schur, модули и высота;
- [`TRIPLE_SOLVER_VERIFICATION.md`](TRIPLE_SOLVER_VERIFICATION.md) — независимая тройная проверка;
- [`SUPPORT_REACTION_STATICS.md`](SUPPORT_REACTION_STATICS.md) — аналитические реакции;
- [`JOINT_CONFIGURATOR.md`](JOINT_CONFIGURATOR.md) — физический конфигуратор;
- [`CONNECTIONS.md`](CONNECTIONS.md) — demand/bolt/weld;
- [`JOINT_STRENGTH_AND_VISUALIZATION.md`](JOINT_STRENGTH_AND_VISUALIZATION.md) — issue #33;
- [`ISSUE_36_STATIC_LOAD_SIMPLIFICATION.md`](ISSUE_36_STATIC_LOAD_SIMPLIFICATION.md) — issue #36;
- [`CRANE_BOOM_CAPACITY.md`](CRANE_BOOM_CAPACITY.md) — горизонтальная стрела;
- [`USAGE_SCENARIOS.md`](USAGE_SCENARIOS.md) — UX;
- [`REFERENCE_CATALOGS_AND_MASSES.md`](REFERENCE_CATALOGS_AND_MASSES.md) — справочники/массы;
- [`VERIFICATION_FOR_NON_SPECIALISTS.md`](VERIFICATION_FOR_NON_SPECIALISTS.md) — паспорт верификации;
- [`LATERAL_CAPACITY_WEATHER_VALIDATION.md`](LATERAL_CAPACITY_WEATHER_VALIDATION.md) — чистый боковой reference case и погода;
- [`STATIC_PAYLOAD_CAPACITY.md`](STATIC_PAYLOAD_CAPACITY.md) — масса груза на вершине;
- [`PERFORMANCE_AND_PROGRESS.md`](PERFORMANCE_AND_PROGRESS.md) — производительность;
- [`CI_CD_REVIEW.md`](CI_CD_REVIEW.md) — CI/CD.

## 1. Цель и обязательные принципы

Калькулятор — статическое браузерное приложение для инженерного исследования мачты из одинаковых сварных арматурных октаэдров.

Обязательно:

1. backend отсутствует, публикация через GitHub Pages;
2. тяжёлый расчёт выполняется в Web Worker;
3. UX начинается с практического вопроса пользователя;
4. одна физическая пользовательская нагрузка не должна иметь дублирующие способы ввода;
5. physical module имеет однозначную топологию и ориентацию;
6. global model — 3D Euler–Bernoulli frame с 6 DOF/node;
7. статический ответ проверяется global FEM, module Schur и independent dense FEM;
8. global eigen-buckling остаётся задачей всей конструкции;
9. реальные болт/две гайки/сварка проверяются отдельным connection-layer;
10. auto-конфигуратор выбирает конкретную физическую сборку и фиксирует её для предельных расчётов;
11. UI, бумажный проект, snapshot и справочники получают данные из общего расчётного результата/каталогов;
12. изменения проходят regression/CI минимум на Linux/macOS/Windows;
13. приложение явно отделяет внутреннюю верификацию от внешней инженерной/натурной проверки.

## 2. Геометрия и раскрой

Пользователь задаёт закупочную длину `Lstock`, число частей `nparts`, диаметр и класс арматуры.

Поддерживается каждый целый раскрой:

```text
1 <= nparts <= 48
```

Нецелые значения и значения вне диапазона отвергаются расчётным каталогом.

```text
a = Lstock/nparts
R = a/sqrt(3)
h = a*sqrt(2/3)
H = N*h
```

Каждый модуль всегда ножками вниз:

```text
3 top-ring members
6 leg members
= 9 рёбер
```

Соседние треугольные уровни повёрнуты на 60°.

Инварианты:

```text
levels = N+1
nodes = 3*(N+1)
members = 9*N
```

Все 9 рёбер правильного модуля имеют длину `a`.

## 3. Материал и сечение ребра

Материал берётся из каталога класса арматуры:

```text
E, nu, Ry, Rm, rho
```

Для круглого сечения:

```text
A = pi*d²/4
Iy = Iz = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
G = E/[2*(1+nu)]
```

## 4. Граничные условия

Production-модель пока имеет абсолютную заделку трёх нижних узлов:

```text
ux=uy=uz=rx=ry=rz=0
```

Тесты issue #26 с шарнирными точечными опорами являются analytical verification fixtures и не меняют production foundation model.

## 5. Пользовательские нагрузки — issue #36

Эксплуатационный расчёт поддерживает:

- собственный вес рёбер;
- лёд;
- ветер на круглые рёбра;
- массу оборудования/груза на вершине;
- парусную площадь оборудования;
- огибающую направлений ветра.

Произвольные пользовательские поля `extraHorizontalLoadN` и `extraVerticalLoadN` удаляются из UX и больше не влияют на production load case. Если такие ключи присутствуют в старом объекте параметров, load builder их игнорирует.

Для vertical top load существует один смысл:

```text
Wequipment = equipmentMassKg * g * equipmentLoadFactor
```

Distributed self-weight/ice/wind прикладываются consistent element load vector.

## 6. Внутренний point-load API

Аналитическим тестам, normalized capacity cases и verification fixtures иногда нужна известная точечная сила. Она не должна возвращаться в пользовательскую форму.

```text
buildLoadCase(model, parameters, {
  topPointLoadN: [Fx, Fy, Fz]
})
```

Вектор распределяется поровну между тремя узлами верхней грани и является внутренним analysis fixture.

## 7. Верхняя грань и помодульный результат — issue #32

Для каждого модуля различаются:

```text
topStructuralFromAbove
topDirectApplied
topAppliedFromAbove = topStructuralFromAbove + topDirectApplied
```

Пользовательская «нагрузка верхней грани» показывает полную сумму. Для одного модуля `topStructuralFromAbove=0`, но масса оборудования не исчезает.

## 8. Global FEM

Каждый узел имеет `ux,uy,uz,rx,ry,rz`. Каждое ребро — 12-DOF spatial Euler–Bernoulli frame element. Восстанавливаются `N,Vy,Vz,T,My,Mz`.

Основной solver использует symmetric-band storage и Cholesky factorization; матрица/факторизация переиспользуется между load cases одной геометрии.

## 9. Проверка ребра

```text
sigma_N = |N|/A
sigma_M = M/W
sigma = sigma_N + sigma_M
tau_T = T*(d/2)/J
tau_V = 4V/(3A)
tau = sqrt(tau_T²+tau_V²)
sigma_eq = sqrt(sigma²+3*tau²)
Ustress = sigma_eq/(Ry/gamma_M)

Leff = 0.5*L
NE = pi²*E*I/Leff²/gamma_M
UEuler = Ncompression/NE
Umember = max(Ustress,UEuler)
```

Это elastic engineering check, не полный нормативный элементный расчёт СП 16.

## 10. Общая устойчивость

```text
(K + lambda*KG)*phi = 0
```

Сохраняются `lambda_cr`, форма, residual/eigenResidual и iterations.

## 11. Точный module Schur solver

Один physical module — 36 DOF: 18 bottom + 18 top.

```text
A = Ktt + Supper
S = Kbb - Kbt*A^-1*Ktb
p = fb - Kbt*A^-1*(ft+pupper)
ut = A^-1*(ft+pupper-Ktb*ub)
```

Результат обязан совпадать с global FEM на floating-point tolerance.

## 12. Третий независимый solver

CI содержит independent dense FEM с отдельной assembly и Gaussian elimination. Сравниваются все DOF, реакции, 12 local end-force components каждого member, residuals и выбранные `lambda_cr` cases. Point-load fixtures передаются через внутренний API issue #36.

## 13. Физический межмодульный узел

```text
2 ребра верхней ножки -> проходная гайка My
болт Mx проходит через My свободно
болт Mx ввинчивается в длинную гайку Mx
4 ребра нижнего модуля приварены к длинной Mx
```

При `N>1`: `Njoints = 3*(N-1)`.

Геометрический проход:

```text
D1 = D - 1.082532*P
D1 - dbolt >= 0.5 мм
reff = s/2
```

## 14. Зацепление и длина болта

```text
Lengagement = 2d  (default)
nturns = Lengagement/P
Lrequired = hclearance + Lengagement + 2 мм
```

В manual доступны `1d/1.5d/2d`. `2d` — правило компоновки, не доказательство thread stripping capacity.

## 15. Нетто-сечение гаек — issue #33

```text
Ahex = sqrt(3)/2*s²
Ahole = pi*D1²/4
Anut,net = Ahex-Ahole
Arib = pi*dbar²/4
Anut,net/Arib >= ksection
ksection >= 2
```

FAIL блокирует узел и предельные расчёты, где он нужен. Критерий не заменяет thread stripping, bearing, local face bending или prying.

## 16. Demand, срез и преднатяг болта — issue #33

```text
Faxis = Fjoint*eb
Fperp = Fjoint-eb(Fjoint*eb)
Nt,direct = max(0,-Faxis)
Ns,direct = |Fperp|
Nt,external = Nt,direct + Mb/reff
Ns = Ns,direct + T/reff

F0,nom = Ttight/(K*d)
F0,max = (1+Gamma)*F0,nom
F0,min = (1-Gamma)*F0,nom
Nt,strength = F0,max + Nt,external

Nbs = Rbs*Ab*ns*gamma_c
Nbt = Rbt*Abn*gamma_c
Ubolt = sqrt((Ns/Nbs)²+(Nt,strength/Nbt)²)
```

Project defaults: `Ttight=200 Н·м`, `K=0.20`, `Gamma=0.25`. Внешняя разделяющая сила консервативно полностью добавляется к max preload; friction/slip credit не используется.

## 17. Сварка и area reserve — issue #33

```text
Qaxial = |N|+2|M|/rw
Qshear = |V|+|T|/rw
Qw = hypot(Qaxial,Qshear)
lw,f = Qw/(beta_f*kf*Rwf*gamma_c)
lw,z = Qw/(beta_z*kf*Rwz*gamma_c)
lw,min = max(4kf,40 мм)

teff = beta_f*kf
Aeff = teff*lweff
Aeff >= kweld*Arib
2 <= kweld <= 3
default kweld = 2.5
```

Коэффициент `2…3×` — project criterion, а не универсальное нормативное требование.

## 18. Auto/manual и фиксация узла

Auto candidate проходит hardware geometry → nut net-section → `reff` → demand → preload → bolt interaction → weld requirements.

После operational FEM узел фиксируется и используется без скрытого увеличения в pure lateral reference, static top payload, horizontal boom и maximum height search.

## 19. 3D-визуализация узла

Визуализация показывает filled гайки/болт, 4+2 реальных направления рёбер, угол `acos(sqrt(2/3))≈35.264°`, ближайшие боковые грани, контакты и зоны шва. Она не выдаётся за CAD-модель резьбы/валика.

## 20. Чистый боковой reference case

`lateralCapacity` — normalized validation task:

```text
F0 = 1 Н transverse
self weight = 0
wind = 0
ice = 0
equipment = 0

Fmember
Fglobal
Fbolt
Flim = min(Fmember,Fglobal,Fbolt)
```

Для compatibility сохраняется `idealizedCraneBoomPayloadKg = Flim/g0`, но это только **pure-tip upper/reference bound**, а не основной расчёт горизонтальной стрелы.

## 21. Горизонтальная стрела — issue #36

Практический вопрос «сколько кг можно подвесить на конце горизонтальной конструкции?» решается отдельным `craneBoomCapacity`.

Та же frame geometry мысленно поворачивается горизонтально. Эквивалентно этому gravity vector арматурных members поворачивается в XY:

```text
qg = rho*A*g*deadLoadFactor
Pend = m*g*equipmentLoadFactor
```

Для каждого направления в секторе 120° проверяются:

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= 1
```

Поиск: baseline при `m=0`, exponential bracketing, затем binary search.

Основной результат:

```text
craneBoomCapacity.maximumEndPayloadMassKg
```

Дополнительно публикуются `configuredEndPayloadMassKg`, `additionalEndPayloadMassKg`, `boomSelfWeightN`, `boomSelfMassEquivalentKg`, `governingDirectionDeg`, `governingMode`.

Собственный вес **арматурных frame members** входит в boom case и должен уменьшать допустимый end payload относительно pure-tip upper bound. Fabrication mass гаек/болтов/сварки пока не добавляется в FEM self-weight. Также отсутствуют dynamics, rope/blocks/winch, pivot, fatigue и специальные crane-code factors. Результат не является паспортной SWL.

## 22. Максимальная масса на вершине вертикальной мачты — issue #36

Gravity-only capacity ищется с собственным весом и фиксированным соединением. Wind/ice отключаются.

```text
maximumTopEquipmentMassKg
configuredTopEquipmentMassKg
additionalTopEquipmentMassKg

additionalTopEquipmentMassKg = max(
  0,
  maximumTopEquipmentMassKg-configuredTopEquipmentMassKg
)
```

Проверяются `Umember<=1`, `Ubolt<=1`, `lambda_cr>=1`.

Water-specific structural output удалён. При необходимости `V=m/rho` вычисляется вне capacity model.

## 23. Максимальная высота

```text
H(N)=N*h
```

Поиск: exponential bracket + binary search + neighbour scan.

Design: `Umember<=1`, `Uconnection<=1`, `lambda_cr>=minimumBucklingFactor`, `displacement<=limit`.

Ultimate resistance: `Umember<=1`, `Uconnection<=1`, `lambda_cr>=1`.

## 24. UX, справочники и массы

Четыре сценария: `check/design/limits/verify`. Порядок: короткий ответ → причина → подробности.

Reference data строится из production catalog code. Fabrication mass показывает rib/joint/module/mast masses, но пока отделена от FEM self-weight из-за feedback `forces -> required weld -> mass -> forces`.

## 25. Верификация

Внутренние уровни включают ручные formulas, force/moment equilibrium, `K*u-F`, analytical beam/frame cases, optimized/reference algebra, global/Schur, independent dense FEM, support statics и negative tests.

Внешний FEM, инженерная рецензия и натурное испытание не получают PASS автоматически.

## 26. Бумажный проект и snapshot

Бумажный проект содержит FEM/stability, physical joint, nut/weld/preload checks, pure lateral reference, vertical top-mass capacity, horizontal-boom self weight/end payload, reference audit и verification passport.

Machine snapshot **v9** содержит отдельные `staticPayloadCapacity`, `lateralCapacity` и `craneBoomCapacity`. Water-equivalent больше не является structural result issue #36.

## 27. CI/CD

Обязательные gates включают Syntax/policy, Secrets scan, Triple FEM, Joint configurator, Joint strength, Support statics, Usage/reference catalogs, **Static loads, crane boom and cut range**, Tests Ubuntu/macOS/Windows и Static site smoke.

Focused issue #36 проверяет `1…48` cuts, игнорирование legacy extra-force fields, internal point-load API, top-mass semantics, отсутствие water-specific result, boom self-weight/end-payload model, pure-lateral distinction, syntax и browser deployability.

## 28. Ограничения

Не скрываются: P-Delta/geometric nonlinearity, initial imperfections/plasticity, finite connection/foundation stiffness, thread stripping/bearing/prying/slip, exact weld geometry/defects/fatigue, согласованное включение hardware/weld mass в self-weight, полный нормативный набор сочетаний, полноценная crane model с dynamics/rope/pivot и внешняя независимая FEM/натурная верификация реальной конструкции.

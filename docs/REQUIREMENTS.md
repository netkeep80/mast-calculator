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
- [`USAGE_SCENARIOS.md`](USAGE_SCENARIOS.md) — UX;
- [`REFERENCE_CATALOGS_AND_MASSES.md`](REFERENCE_CATALOGS_AND_MASSES.md) — справочники/массы;
- [`VERIFICATION_FOR_NON_SPECIALISTS.md`](VERIFICATION_FOR_NON_SPECIALISTS.md) — паспорт верификации;
- [`LATERAL_CAPACITY_WEATHER_VALIDATION.md`](LATERAL_CAPACITY_WEATHER_VALIDATION.md) — боковая сила/погода/идеализированная стрела;
- [`STATIC_PAYLOAD_CAPACITY.md`](STATIC_PAYLOAD_CAPACITY.md) — масса груза на вершине;
- [`PERFORMANCE_AND_PROGRESS.md`](PERFORMANCE_AND_PROGRESS.md) — производительность;
- [`CI_CD_REVIEW.md`](CI_CD_REVIEW.md) — CI/CD.

## 1. Цель и обязательные принципы

Калькулятор — статическое браузерное приложение для инженерного исследования мачты из одинаковых сварных арматурных октаэдров.

Обязательно:

1. backend отсутствует, публикация через GitHub Pages;
2. тяжёлый расчёт выполняется в Web Worker с progress/ETA/cancel;
3. UX начинается с практического вопроса пользователя, а не с внутренней FEM-конфигурации;
4. одна физическая пользовательская нагрузка не должна иметь дублирующие способы ввода;
5. physical module имеет однозначную топологию и ориентацию;
6. global model — 3D Euler–Bernoulli frame с 6 DOF/node;
7. статический ответ проверяется global FEM, module Schur и independent dense FEM;
8. global eigen-buckling остаётся задачей всей мачты;
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

Параметры материала берутся из каталога класса арматуры:

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

Пользователь не должен вручную подменять однозначно производные свойства.

## 4. Граничные условия

Production-модель пока имеет абсолютную заделку трёх нижних узлов:

```text
ux=uy=uz=rx=ry=rz=0
```

Тесты issue #26 с шарнирными точечными опорами являются только analytical verification fixtures и не меняют production foundation model.

## 5. Пользовательские нагрузки — issue #36

Эксплуатационный расчёт поддерживает:

- собственный вес рёбер;
- лёд;
- ветер на круглые рёбра;
- массу оборудования/груза на вершине;
- парусную площадь оборудования;
- огибающую направлений ветра.

Произвольные пользовательские поля:

```text
extraHorizontalLoadN
extraVerticalLoadN
```

удаляются из UX и больше не влияют на production load case. Если такие ключи присутствуют в старом сохранённом объекте, они считаются legacy metadata и игнорируются load builder.

Для vertical top load существует один смысл:

```text
equipment weight = equipmentMassKg * g * gamma_equipment
```

Distributed self-weight/ice/wind прикладываются consistent element load vector с эквивалентными силами и моментами.

## 6. Внутренний point-load API

Независимым аналитическим тестам, normalized capacity cases и verification fixtures иногда нужна известная точечная сила. Она не должна возвращаться в пользовательскую форму.

Для этого используется отдельный API:

```text
buildLoadCase(model, parameters, {
  topPointLoadN: [Fx, Fy, Fz]
})
```

Вектор распределяется поровну между тремя узлами верхней грани. Он является внутренним test/analysis fixture, а не эксплуатационным пользовательским параметром.

## 7. Верхняя грань и помодульный результат — issue #32

Для каждого модуля различаются:

```text
topStructuralFromAbove = действие физических модулей выше
topDirectApplied = внешняя нагрузка непосредственно на верхнюю грань
topAppliedFromAbove = topStructuralFromAbove + topDirectApplied
```

Пользовательская величина «нагрузка верхней грани» показывает полную сумму. Для одного модуля `topStructuralFromAbove=0`, но масса оборудования на вершине не исчезает.

Баланс соседних модулей проверяется по structural action без двойного учёта direct nodal load.

## 8. Global FEM

Каждый узел:

```text
[ux,uy,uz,rx,ry,rz]
```

Каждое ребро — 12-DOF spatial Euler–Bernoulli frame element.

Восстанавливаются:

```text
N, Vy, Vz, T, My, Mz
```

Основной solver использует symmetric-band storage и Cholesky factorization. Матрица/факторизация переиспользуется между load cases одной геометрии.

## 9. Проверка ребра

Упругая прочность:

```text
sigma_N = |N|/A
sigma_M = M/W
sigma = sigma_N + sigma_M

tau_T = T*(d/2)/J
tau_V = 4V/(3A)
tau = sqrt(tau_T²+tau_V²)

sigma_eq = sqrt(sigma²+3*tau²)
Ustress = sigma_eq/(Ry/gamma_M)
```

Локальный Euler:

```text
Leff = 0.5*L
NE = pi²*E*I/Leff²/gamma_M
UEuler = Ncompression/NE
Umember = max(Ustress,UEuler)
```

Это elastic engineering check, не полный нормативный элементный расчёт СП 16.

## 10. Общая устойчивость

Linear eigen-buckling:

```text
(K + lambda*KG)*phi = 0
```

Сохраняются `lambda_cr`, форма, residual/eigenResidual и iterations. Общая форма может охватывать много модулей.

## 11. Точный module Schur solver

Один physical module — 36 DOF:

```text
bottom = 18 DOF
top = 18 DOF
```

Top-down condensation:

```text
A = Ktt + Supper
S = Kbb - Kbt*A^-1*Ktb
p = fb - Kbt*A^-1*(ft+pupper)
```

Bottom-up recovery:

```text
ut = A^-1*(ft+pupper-Ktb*ub)
```

Результат обязан совпадать с global FEM на floating-point tolerance.

## 12. Третий независимый solver

CI содержит independent dense FEM, который независимо собирает element stiffness/load vectors, full dense `K`, решает Gaussian elimination и восстанавливает reactions/end forces.

Сравниваются:

```text
все 6 DOF
реакции
12 local end-force components каждого member
остатки
выбранные lambda_cr reference cases
```

Point-load fixtures для cross-check передаются через внутренний API issue #36.

## 13. Физический межмодульный узел

Каждый внутренний стык:

```text
2 ребра верхней ножки -> проходная гайка My
болт Mx проходит через My свободно
болт Mx ввинчивается в длинную гайку Mx
4 ребра нижнего модуля приварены к длинной Mx
```

При `N>1`:

```text
Njoints = 3*(N-1)
```

Проходная гайка обязана иметь геометрический проход:

```text
D1 - dbolt >= 0.5 мм
D1 = D - 1.082532*P
```

Длинная гайка имеет резьбу болта; effective radius:

```text
reff = s/2
```

## 14. Зацепление и длина болта

По умолчанию:

```text
Lengagement = 2d
```

В manual доступны `1d/1.5d/2d`.

```text
nturns = Lengagement/P
Lrequired = hclearance + Lengagement + 2 мм
```

Выбирается ближайшая большая стандартная длина. `2d` — правило компоновки, не доказательство thread stripping capacity.

## 15. Нетто-сечение гаек — issue #33

Обе гайки проходят дополнительный geometry reserve:

```text
Ahex = sqrt(3)/2*s²
Ahole = pi*D1²/4
Anut,net = Ahex-Ahole
Arib = pi*dbar²/4
Anut,net/Arib >= ksection
ksection >= 2
```

FAIL блокирует узел, auto candidate и предельные расчёты, где межмодульный узел существует. Критерий не заменяет thread stripping, bearing, local face bending или prying.

## 16. Demand и срез болта — issue #33

Для двух верхних рёбер одного load case:

```text
Fjoint = F1+F2
Mjoint = M1+M2
Faxis = Fjoint*eb
Fperp = Fjoint-eb(Fjoint*eb)
Nt,direct = max(0,-Faxis)
Ns,direct = |Fperp|

T = |Mjoint*eb|
Mb = |Mjoint-eb(Mjoint*eb)|
Nt,external = Nt,direct + Mb/reff
Ns = Ns,direct + T/reff
```

`Ns,direct` явно хранится как срез от наклонной силы.

## 17. Преднатяг — issue #33

Torque-controlled approximation:

```text
T = K*F0*d
F0,nom = T/(K*d)
F0,max = (1+Gamma)*F0,nom
F0,min = (1-Gamma)*F0,nom
```

Project defaults:

```text
T = 200 Н·м
K = 0.20
Gamma = 0.25
```

Для прочности:

```text
Nt,strength = F0,max + Nt,external
```

Это conservative upper-bound model: внешнее разделяющее усилие полностью добавляется к преднатягу; slip/friction credit не используется.

## 18. Болт

```text
Nbs = Rbs*Ab*ns*gamma_c
Nbt = Rbt*Abn*gamma_c
Us = Ns/Nbs
Ut = Nt,strength/Nbt
Ubolt = sqrt(Us²+Ut²)
PASS if Ubolt <= 1
```

Публикуются `Upreload`, `F0,max`, внешнее растяжение, tensile reserve и direct shear. Классы без `Rbt` не объявляются пригодными при ненулевом растяжении.

## 19. Сварка и area reserve — issue #33

Для каждого member end берутся coincident `N/V/T/M`.

```text
Qaxial = |N|+2|M|/rw
Qshear = |V|+|T|/rw
Qw = hypot(Qaxial,Qshear)

lw,f = Qw/(beta_f*kf*Rwf*gamma_c)
lw,z = Qw/(beta_z*kf*Rwz*gamma_c)
lw,min = max(4kf,40 мм)
```

Дополнительный проектный запас:

```text
teff = beta_f*kf
Aeff = teff*lweff
Aeff >= kweld*Arib
2 <= kweld <= 3
default kweld = 2.5
```

```text
lweff = max(lw,f,lw,z,lw,min,kweld*Arib/teff)
Lphysical = lweff + 10 мм*nsegments
```

`2…3×` — консервативный project criterion, а не универсальное нормативное требование.

## 20. Auto/manual и фиксация узла

Auto candidate проходит:

```text
hardware geometry
nut net-section ratio
bolt preload+tension+shear
```

После operational FEM узел фиксируется и используется без скрытого увеличения в:

```text
lateral capacity
static top payload capacity
maximum height search
```

Manual mode проверяется теми же критериями.

## 21. 3D-визуализация узла

Визуализация обязана:

- показывать заполненные гайки/болт с простой procedural metal texture;
- строить 4 направления рёбер длинной гайки и 2 направления проходной гайки;
- показывать диагональный угол `acos(sqrt(2/3)) ≈ 35.264°`;
- определять ближайшую боковую грань для каждого ребра;
- показывать контакт и зоны шва;
- не притворяться CAD-точностью резьбы/валика.

## 22. Боковой предел / идеализированная стрела — issue #36

Normalized lateral test использует внутреннюю horizontal point load `1 Н`, а не пользовательский extra-force parameter.

Отключаются:

```text
weather
ice
self weight
equipment
```

Независимые envelopes:

```text
Fmember
Fglobal
Fbolt
Flim = min(Fmember,Fglobal,Fbolt)
```

Публикуются N/kgf и:

```text
idealizedCraneBoomPayloadKg = Flim/g0
```

Это эквивалент концевого поперечного груза для идеализированной консольной стрелы. Собственный вес горизонтально ориентированной стрелы и динамика подъёма в этой задаче отсутствуют, поэтому результат нельзя маркировать как crane SWL.

## 23. Максимальная масса на вершине — issue #36

Gravity-only capacity ищется с собственным весом мачты и фиксированным выбранным соединением. Wind/ice отключаются.

Главные результаты:

```text
maximumTopEquipmentMassKg
configuredTopEquipmentMassKg
additionalTopEquipmentMassKg
```

```text
additionalTopEquipmentMassKg = max(
  0,
  maximumTopEquipmentMassKg-configuredTopEquipmentMassKg
)
```

Проверяются:

```text
Umember<=1
Ubolt<=1
lambda_cr>=1
```

Water-specific result удалён. При необходимости:

```text
V=m/rho
```

вычисляется вне structural capacity model.

## 24. Максимальная высота

Высота дискретна:

```text
H(N)=N*h
```

Поиск: exponential bracket + binary search + neighbour scan.

Design:

```text
Umember<=1
Uconnection<=1
lambda_cr>=minimumBucklingFactor
displacement<=limit
```

Ultimate resistance:

```text
Umember<=1
Uconnection<=1
lambda_cr>=1
```

Если отказ не найден до search cap, показывается `>=Hsearch`.

## 25. UX и справочники

Четыре сценария: `check/design/limits/verify`.

Порядок:

```text
короткий ответ -> причина -> подробности
```

Reference data строится из production catalog code. Project criteria должны иметь явный статус и не выдаваться за нормы.

## 26. Масса физической сборки

Показываются rib/joint/module/mast fabrication masses. Метизы оцениваются геометрически, weld deposit — через `k²/2 * L`. Fabrication mass пока отделена от FEM self-weight из-за feedback:

```text
forces -> required weld -> mass -> forces
```

## 27. Верификация

Внутренние уровни включают:

- ручные формулы geometry/mass/weather;
- force/moment equilibrium;
- `K*u-F` residual;
- аналитические beam/frame cases;
- optimized vs reference algebra;
- global vs Schur;
- independent dense FEM;
- support statics oracles;
- negative tests.

Внешний FEM, инженерная рецензия и натурное испытание не получают PASS автоматически.

## 28. Бумажный проект и snapshot

Бумажный проект содержит:

```text
геометрию/FEM/stability
физический узел
Anut/Arib
T,K,Gamma,F0,max,Upreload
direct bolt shear
Aeff,weld/Arib
Flim и idealized crane-boom payload
максимальную top mass и additional kg reserve
single-source reference audit
verification passport
```

Machine snapshot остаётся внутренним средством воспроизводимости. Water-equivalent не является структурным результатом issue #36.

## 29. CI/CD

Обязательные gates:

```text
Syntax, policy and maintainability
Secrets scan
Triple FEM equivalence
Joint configurator
Joint strength and visualization
Support reaction statics
Usage scenarios and reference catalogs
Static load simplification and cut range
Tests Ubuntu/macOS/Windows
Static site smoke test
```

Focused issue #36 gate проверяет:

- `1…48` cuts;
- legacy extra-force fields не влияют на production load;
- internal point-load API;
- top mass + additional kg semantics;
- отсутствие water-specific capacity result;
- lateral crane-boom interpretation;
- JavaScript syntax.

## 30. Ограничения

Не должны скрываться:

- P-Delta/geometric nonlinearity;
- initial imperfections/plasticity;
- finite connection/foundation stiffness;
- thread stripping по фактическому материалу/допускам;
- bearing/local face bending/prying;
- точное распределение внешнего bolt load по stiffness ratio;
- friction-grip/slip;
- фактическая weld geometry/defects/residual stress/fatigue;
- самоотвинчивание;
- полный нормативный набор сочетаний;
- согласованное включение hardware/weld mass в self-weight;
- полноценная horizontal crane-boom model с self-weight/dynamics;
- внешняя независимая FEM/натурная верификация реальной конструкции.

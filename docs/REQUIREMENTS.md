# Требования к Калькулятору мачты

Статус: актуальная рабочая спецификация после issues #18, #21, #26, #27, #32 и #33.

Специализированные документы:

- [`CALCULATION_ARCHITECTURE.md`](CALCULATION_ARCHITECTURE.md) — FEM и численные пути;
- [`MODULAR_ANALYSIS_AND_HEIGHT.md`](MODULAR_ANALYSIS_AND_HEIGHT.md) — Schur, модули и высота;
- [`TRIPLE_SOLVER_VERIFICATION.md`](TRIPLE_SOLVER_VERIFICATION.md) — независимая тройная проверка;
- [`SUPPORT_REACTION_STATICS.md`](SUPPORT_REACTION_STATICS.md) — аналитические реакции;
- [`JOINT_CONFIGURATOR.md`](JOINT_CONFIGURATOR.md) — физический конфигуратор;
- [`CONNECTIONS.md`](CONNECTIONS.md) — demand/bolt/weld;
- [`JOINT_STRENGTH_AND_VISUALIZATION.md`](JOINT_STRENGTH_AND_VISUALIZATION.md) — issue #33;
- [`USAGE_SCENARIOS.md`](USAGE_SCENARIOS.md) — UX;
- [`REFERENCE_CATALOGS_AND_MASSES.md`](REFERENCE_CATALOGS_AND_MASSES.md) — справочники/массы;
- [`VERIFICATION_FOR_NON_SPECIALISTS.md`](VERIFICATION_FOR_NON_SPECIALISTS.md) — паспорт верификации;
- [`LATERAL_CAPACITY_WEATHER_VALIDATION.md`](LATERAL_CAPACITY_WEATHER_VALIDATION.md) — боковая сила/погода;
- [`STATIC_PAYLOAD_CAPACITY.md`](STATIC_PAYLOAD_CAPACITY.md) — статическая масса;
- [`PERFORMANCE_AND_PROGRESS.md`](PERFORMANCE_AND_PROGRESS.md) — производительность;
- [`CI_CD_REVIEW.md`](CI_CD_REVIEW.md) — CI/CD.

## 1. Цель и обязательные принципы

Калькулятор — статическое браузерное приложение для инженерного исследования мачты из одинаковых сварных арматурных октаэдров.

Обязательно:

1. backend отсутствует, публикация через GitHub Pages;
2. тяжёлый расчёт выполняется в Web Worker с progress/ETA/cancel;
3. UX начинается с практического вопроса пользователя, а не с внутренней FEM-конфигурации;
4. физический модуль имеет однозначную топологию и ориентацию;
5. global model — 3D Euler–Bernoulli frame с 6 DOF/node;
6. статический ответ проверяется global FEM, module Schur и independent dense FEM;
7. global eigen-buckling остаётся задачей всей мачты;
8. реальные болт/две гайки/сварка проверяются отдельным connection-layer;
9. auto-конфигуратор выбирает конкретную физическую сборку и фиксирует её для предельных расчётов;
10. UI, бумажный проект, snapshot и справочники получают данные из общего расчётного результата/каталогов;
11. все изменения проходят regression/CI минимум на Linux/macOS/Windows;
12. приложение явно отделяет внутреннюю верификацию от внешней инженерной/натурной проверки.

## 2. Геометрия модуля

Пользователь задаёт закупочную длину `Lstock`, число частей `nparts`, диаметр и класс арматуры.

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

Все 9 рёбер одного правильного модуля имеют длину `a`.

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

Тесты issue #26 с шарнирными точечными опорами являются только аналитическим verification fixture и не меняют production foundation model.

## 5. Нагрузки

Поддерживаются:

- собственный вес рёбер;
- лёд;
- ветер на круглые рёбра;
- масса/парусность оборудования;
- дополнительная горизонтальная сила;
- дополнительная вертикальная сила;
- огибающая направлений ветра.

Distributed self-weight/ice/wind должны прикладываться через consistent element load vector, включая эквивалентные узловые силы и моменты.

`equipmentMassKg` и `extraVerticalLoadN` не являются дублями:

```text
equipment weight = m*g*gamma_equipment
extraVerticalLoadN = уже заданная сила в Н
```

Одна физическая нагрузка не должна вводиться одновременно в оба поля.

## 6. Верхняя грань и помодульный результат — issue #32

Для каждого модуля должны различаться:

```text
topStructuralFromAbove = действие физических модулей выше
topDirectApplied = внешняя нагрузка непосредственно на верхнюю грань
topAppliedFromAbove = topStructuralFromAbove + topDirectApplied
```

Пользовательская величина «нагрузка верхней грани» обязана показывать полную сумму. Для одного модуля `topStructuralFromAbove=0`, но груз оборудования на вершине не должен исчезать.

Баланс соседних модулей проверяется по structural action без двойного учёта direct nodal load.

## 7. Global FEM

Каждый узел имеет:

```text
[ux,uy,uz,rx,ry,rz]
```

Каждое ребро — 12-DOF spatial Euler–Bernoulli frame element.

Восстанавливаются:

```text
N, Vy, Vz, T, My, Mz
```

Основной solver использует symmetric-band storage и Cholesky factorization. Матрица/факторизация переиспользуются между load cases одной геометрии.

## 8. Проверка ребра

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

## 9. Общая устойчивость

Linear eigen-buckling:

```text
(K + lambda*KG)*phi = 0
```

Сохраняются `lambda_cr`, форма, residual/eigenResidual, iterations. Общая форма может охватывать много модулей, поэтому её нельзя заменить независимыми проверками отдельных модулей.

## 10. Точный module Schur solver

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

Результат обязан совпадать с global FEM по всем DOF в заданном floating-point tolerance.

## 11. Третий независимый solver

CI содержит independent dense FEM, который независимо собирает element stiffness/load vectors, full dense `K`, решает Gaussian elimination и восстанавливает реакции/end forces.

Сравниваются:

```text
все 6 DOF
реакции
12 local end-force components каждого member
остатки
выбранные lambda_cr reference cases
```

Третий solver не участвует в обычном browser calculation и служит numerical oracle.

## 12. Физический межмодульный узел

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

Длинная гайка имеет резьбу болта; расчётная длина каталога — `3d`. Эффективный радиус:

```text
reff = s/2
```

## 13. Зацепление и длина болта

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

## 14. Нетто-сечение гаек — issue #33

Обе гайки должны проходить дополнительную геометрическую проверку:

```text
Ahex = sqrt(3)/2*s²
Ahole = pi*D1²/4
Anut,net = Ahex-Ahole
Arib = pi*dbar²/4
Anut,net/Arib >= ksection
ksection >= 2
```

Проверяются длинная и проходная гайки. FAIL блокирует узел, auto-кандидат и предельные расчёты, где этот межмодульный узел нужен.

Критерий не заменяет thread stripping, bearing, local face bending или prying.

## 15. Demand и срез болта — issue #33

Для двух верхних рёбер одного load case:

```text
Fjoint = F1+F2
Mjoint = M1+M2
Faxis = Fjoint·eb
Fperp = Fjoint-eb(Fjoint·eb)
Nt,direct = max(0,-Faxis)
Ns,direct = |Fperp|
```

Моменты:

```text
T = |Mjoint·eb|
Mb = |Mjoint-eb(Mjoint·eb)|
Nt,external = Nt,direct + Mb/reff
Ns = Ns,direct + T/reff
```

`Ns,direct` должен явно храниться/показываться как срез от наклонной силы.

## 16. Преднатяг от момента затяжки — issue #33

Torque-controlled approximation:

```text
T = K*F0*d
F0,nom = T/(K*d)
F0,max = (1+Gamma)*F0,nom
F0,min = (1-Gamma)*F0,nom
```

Defaults проекта:

```text
T = 200 Н·м
K = 0.20
Gamma = 0.25
```

Они должны быть видимы/настраиваемы и попадать в snapshot/report/reference data.

Для прочности:

```text
Nt,strength = F0,max + Nt,external
```

Это консервативная upper-bound модель: внешнее разделяющее усилие полностью добавляется к преднатягу; slip/friction credit не используется.

## 17. Болт

```text
Nbs = Rbs*Ab*ns*gamma_c
Nbt = Rbt*Abn*gamma_c
Us = Ns/Nbs
Ut = Nt,strength/Nbt
Ubolt = sqrt(Us²+Ut²)
PASS if Ubolt <= 1
```

Публикуются также `Upreload`, `F0,max`, внешнее растяжение, остаток tensile reserve и прямой срез.

Классы без `Rbt` не могут объявляться пригодными при ненулевом растяжении.

## 18. Сварка и дополнительный area-reserve — issue #33

Для каждого member end берутся coincident `N/V/T/M`.

Силовая surrogate-модель:

```text
Qaxial = |N|+2|M|/rw
Qshear = |V|+|T|/rw
Qw = hypot(Qaxial,Qshear)

lw,f = Qw/(beta_f*kf*Rwf*gamma_c)
lw,z = Qw/(beta_z*kf*Rwz*gamma_c)
```

Конструктивный минимум:

```text
lw,min = max(4kf,40 мм)
```

Issue #33 добавляет:

```text
teff = beta_f*kf
Aeff = teff*lweff
Aeff >= kweld*Arib
2 <= kweld <= 3
default kweld = 2.5
```

Итог:

```text
lweff = max(lw,f,lw,z,lw,min,kweld*Arib/teff)
Lphysical = lweff + 10 мм*nsegments
```

`2…3×` — дополнительный консервативный проектный критерий; он не должен маркироваться как нормативное требование AISC/СП.

## 19. Auto/manual и фиксация узла

Auto candidate проходит только при одновременном выполнении:

```text
hardware geometry
nut net-section ratio
bolt preload+tension+shear
```

После operational FEM узел фиксируется и используется без автоматического увеличения в:

```text
lateral capacity
static top payload capacity
maximum height search
```

Manual mode сохраняет выбранные пользователем дискретные детали и проверяет их теми же критериями.

## 20. 3D-визуализация issue #33

Визуализация соединения обязана:

- показывать заполненные гайки/болт с простой процедурной металлической текстурой;
- не обязана рисовать резьбу;
- строить 4 направления рёбер длинной гайки и 2 направления рёбер проходной гайки из геометрии правильного октаэдра;
- показывать диагональный угол `acos(sqrt(2/3)) ≈ 35.264°` к оси болта;
- определять ближайшую боковую грань для каждого ребра;
- показывать контакт ребра с гранью и зоны шва;
- оставаться инженерной схемой, а не притворяться CAD-точностью.

## 21. Боковая предельная нагрузка

Отдельный normalized tip-load test исключает weather/dead/equipment loads и использует единичную горизонтальную силу. Формируются независимые envelopes:

```text
member limit
global buckling limit
selected fixed bolt limit
first limit = min(...)
```

Результат выводится в N и kgf; это не crane SWL.

## 22. Статическая масса на вершине

Gravity-only capacity ищется с собственным весом мачты и фиксированным выбранным соединением. Ветер/лёд отключаются. Проверяются member, bolt, global buckling. Выводятся total top mass, remaining reserve и water-equivalent.

## 23. Максимальная высота

Высота дискретна `H(N)=N*h`. Поиск использует exponential bracket + binary search + neighbour scan.

Design limit:

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

Если отказ не найден до search cap, показывается нижняя оценка `>=Hsearch`.

## 24. UX и справочники

Четыре сценария: check/design/limits/verify. Главный результат: короткий ответ → объяснение → подробности.

Reference data строится из production catalog code. Текущая схема должна включать issue #33:

```text
mast-calculator/reference-data/v2
bolt preload defaults/source
nut net-section ratio
weld effective-area range/default
```

Проектные коэффициенты `2×`/`2…3×` должны быть явно помечены как project criteria.

## 25. Масса физической сборки

Показываются rib/joint/module/mast fabrication masses. Метизы оцениваются геометрически, weld deposit — через `k²/2 * L`. Fabrication mass пока отделена от FEM self-weight из-за feedback `forces -> required weld -> mass -> forces`.

## 26. Верификация

Внутренние уровни должны включать:

- ручные формулы геометрии/массы/weather;
- force/moment equilibrium;
- `K*u-F` residual;
- аналитические beam/frame cases;
- optimized vs reference algebra;
- global vs Schur;
- independent dense FEM;
- support statics oracles;
- negative tests, которые обязаны обнаруживать намеренную ошибку.

Внешний FEM, инженерная рецензия и натурное испытание не получают PASS автоматически.

## 27. Бумажный проект и snapshot

Бумажный проект должен содержать формулы/подстановки/критические значения, включая:

```text
геометрию и FEM
stability/capacities
физический узел
Anut/Arib
T,K,Gamma,F0,max,Upreload
прямой bolt shear от наклонной силы
Aeff,weld/Arib
single-source reference audit
verification passport
```

Machine snapshot остаётся внутренним средством воспроизводимости и хранит полные connection fields.

## 28. CI/CD

Обязательные независимые gates:

```text
Syntax, policy and maintainability
Secrets scan
Triple FEM equivalence
Joint configurator
Joint strength and visualization
Support reaction statics
Usage scenarios and reference catalogs
Tests Ubuntu/macOS/Windows
Static site smoke test
```

`Joint strength and visualization` обязан проверять nut sections, weld area ratio, torque-preload, oblique bolt shear и 3D geometry/contact/weld semantics.

## 29. Ограничения

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
- внешняя независимая FEM/натурная верификация реальной конструкции.

# Требования к Mast Calculator

Статус: рабочая спецификация прототипа 1.0.

Специализированные документы:

- [`CALCULATION_ARCHITECTURE.md`](CALCULATION_ARCHITECTURE.md) — FEM и численный solver;
- [`CONNECTIONS.md`](CONNECTIONS.md) — межмодульный болт, подбор диаметра и сварные концы;
- [`VERIFICATION_FOR_NON_SPECIALISTS.md`](VERIFICATION_FOR_NON_SPECIALISTS.md) — пошаговая верификация;
- [`LATERAL_CAPACITY_WEATHER_VALIDATION.md`](LATERAL_CAPACITY_WEATHER_VALIDATION.md) — боковая нагрузка, погода и solid-rod sanity-check;
- [`STATIC_PAYLOAD_CAPACITY.md`](STATIC_PAYLOAD_CAPACITY.md) — вертикальная масса вершины;
- [`PERFORMANCE_AND_PROGRESS.md`](PERFORMANCE_AND_PROGRESS.md) — performance/Worker;
- [`CI_CD_REVIEW.md`](CI_CD_REVIEW.md) — CI/CD.

## 1. Цель и границы продукта

Mast Calculator — статическое браузерное приложение для расчёта, проверки и последующей оптимизации модульной мачты из одинаковых арматурных октаэдров.

Обязательные принципы:

1. backend не требуется; публикация — GitHub Pages;
2. пользовательский ввод ориентирован на реальные параметры изготовления и эксплуатации;
3. глобальный frame solver отделён от физического post-processing соединений;
4. соединения используют совпадающие `N/V/T/M` одного load case, а не искусственные независимые максимумы;
5. расчётное ядро имеет analytical/reference/regression checks;
6. результат воспроизводим и связан с Git SHA;
7. пользователь получает человекочитаемый расчётный проект;
8. UI показывает границу доказанности результата;
9. расчётные изменения проходят CI на Linux/macOS/Windows.

Прототип не является сертификатом конструкции и не должен скрывать отсутствующие проверки конкретного реального узла.

## 2. Практический ввод

Основной ввод:

```text
moduleCount
stockBarLengthMm
stockBarPieces
barDiameterMm
reinforcementClass
weather/wind parameters
ice parameters
equipment mass and wind area
extra horizontal/vertical loads
```

Ввод соединения прототипа 1.0:

```text
jointBoltDiameterMm
jointBoltClass
jointBoltShearPlanes
jointEffectiveRadiusMm
connectionConditionFactor
jointBaseMetalTensileStrengthMPa
weldConsumableId
weldLegMm
weldSegmentsPerEnd
weldBetaF
weldBetaZ
```

Пользователь не вводит вручную:

```text
ribCutLengthMm
moduleHeightMm
E, nu, Ry, Rm, steel density
effectiveLengthFactor текущей fixed-fixed идеализации
```

Эти величины вычисляются или берутся из каталогов.

## 3. Геометрия правильного октаэдра

До учёта kerf/trim/joint overlap:

```text
a = Lstock/nparts
R = a/sqrt(3)
h = a*sqrt(2/3)
H = Nmodules*h
```

Нижняя и верхняя равносторонние треугольные грани имеют сторону `a` и повёрнуты на 60°.

Один модуль:

```text
3 horizontal members
6 diagonal members
= 9 members
```

Если верхняя грань замкнута, добавляются 3 верхних member.

Regression invariant: геометрическая длина каждого member совпадает с `a` в установленном численном допуске.

Пока осевая FEM-геометрия не учитывает:

- ширину реза;
- торцевую подрезку;
- заход/нахлёст арматуры на узел;
- дополнительную высоту гайки/болта;
- эксцентриситет оси member внутри физического узла.

## 4. Глобальная 3D frame-модель

Global solver отвечает на вопрос:

> выдерживает ли арматурный каркас нагрузки, если геометрические узлы считать идеально жёсткими?

Node DOF:

```text
[ux, uy, uz, rx, ry, rz]
```

Member — пространственный Euler–Bernoulli frame-element, 12 DOF.

Круглое сечение:

```text
A = pi*d²/4
Iy = Iz = pi*d⁴/64
J = pi*d⁴/32
W = pi*d³/32
G = E/[2*(1+nu)]
```

Жёсткости:

```text
EA
EIy
EIz
GJ
```

Каждый member возвращает:

```text
N
Vy, Vz
T
My, Mz
```

Три нижних узла полностью заделаны по 6 DOF. Фундамент — отдельный будущий модуль.

## 5. Нагрузки

Эксплуатационный расчёт поддерживает:

- собственный вес стали;
- цилиндрический слой льда;
- ветер на пространственно ориентированные круглые members;
- массу оборудования;
- ветер на оборудование;
- дополнительную горизонтальную силу;
- дополнительную вертикальную силу;
- огибающую направлений ветра.

Собственный вес, лёд и ветер на member задаются distributed element loads.

Для равномерной transverse load consistent nodal vector содержит силы `qL/2` и конечные моменты `qL²/12`.

Для цилиндрического member используется только нормальная к его оси компонента ветра.

## 6. Погодные сценарии

UI поддерживает полный Beaufort 0–12 и пользовательский `windPressurePa`.

Для preset:

```text
q = rho_air*v²/2
rho_air = 1.225 kg/m³
```

Beaufort presets — сравнительный UX-инструмент, не замена нормативному ветровому районированию и сочетаниям СП 20.

## 7. Проверка member

Упругая stress-проверка:

```text
sigma_N = |N|/A
sigma_M = M/W
sigma = sigma_N + sigma_M

tau_T = T*(d/2)/J
tau_V = 4V/(3A)
tau = sqrt(tau_T² + tau_V²)

sigma_eq = sqrt(sigma² + 3*tau²)
eta_sigma = sigma_eq/(Ry/gamma_M)
```

Для distributed transverse load нельзя терять максимум момента внутри элемента.

Локальная Euler-проверка:

```text
Leff = mu*L
mu = 0.5
N_E = pi²*E*I/Leff²/gamma_M
eta_Euler = Ncompression/N_E
```

Итог:

```text
eta_member = max(eta_sigma, eta_Euler)
```

Это инженерная упругая проверка, не полный нормативный member design по СП 16.

## 8. Общая линейная устойчивость

После static solve формируется `KG`:

```text
(K + lambda*KG)*phi = 0
```

Сохраняются:

```text
criticalLoadFactor
mode translations
mode rotations
residual/eigenResidual
iterations
```

Matrix-free generalized Lanczos обязан подтверждать результат невязкой исходной generalized eigen-задачи.

Пока не реализованы P-Delta, geometric nonlinearity, initial imperfections и пластичность.

## 9. Производительность

Для одной геометрии действует `compile once, solve many`:

```text
geometry/transforms
free DOF map
banded K
Cholesky(K) once
```

Operational/lateral/static-payload cases используют одну факторизацию `K`.

40-модульный regression invariant:

```text
720 free DOF
half-bandwidth <= 35
stiffnessFactorizationCount = 1
```

Тяжёлый browser calculation работает в Web Worker. UI имеет progress, elapsed time, ETA и отмену через termination Worker.

## 10. Физическая модель межмодульного соединения

Это обязательная реализация issue #15.

На каждом внутреннем геометрическом node сходятся шесть members. Физически они разделены так:

```text
нижний модуль:
  2 диагонали снизу
  2 горизонтальных ребра
  = 4 members

верхний модуль:
  2 диагонали следующей ножки
  = 2 members
```

Один вертикальный болт соединяет двухреберную часть верхнего модуля с четырёхреберной частью нижнего.

Для `N>1`:

```text
Njoints = 3*(N - 1)
```

Три фундаментных node не входят в этот тип соединения.

## 11. Demand межмодульного болта

Для каждого внутреннего node выбираются ровно два members, идущие на следующий уровень. Их совпадающие end forces одного load case преобразуются в global coordinates и суммируются:

```text
Fjoint = F1 + F2
Mjoint = M1 + M2
```

Ось болта:

```text
eb = [0,0,1]
```

Прямые составляющие:

```text
Faxis = Fjoint dot eb
Fperp = Fjoint - eb*Faxis
```

Из-за передачи момента идеальной frame-моделью вводится явный физический параметр `reff=jointEffectiveRadiusMm`:

```text
Nt = |Faxis| + |Mb|/reff
Ns = |Fperp| + |T|/reff
```

`reff` должен соответствовать фактической контактной геометрии шайбы/гайки/упора. Это не скрытая константа.

Запрещено смешивать `N/V/T/M` из разных load cases.

## 12. Расчёт и подбор болта

Каталог хранит данные СП 16.13330.2017 для классов:

```text
5.6
5.8
8.8
10.9
12.9
```

и общего ряда:

```text
M16 M20 M24 M30 M36 M42 M48
```

Размеры M18/M22/M27 из таблицы Г.9, отмеченные для опор ВЛ/ОРУ, не входят в общий автоматический подбор.

Расчётная несущая способность одного болта:

```text
Nbs = Rbs*Ab*ns*gamma_b*gamma_c
Nbt = Rbt*Abn*gamma_c
```

Для текущего одноболтового узла:

```text
gamma_b = 1
```

Совместное действие:

```text
Ubolt = sqrt((Ns/Nbs)^2 + (Nt/Nbt)^2)
PASS: Ubolt <= 1
```

Класс 5.8 не объявляется пригодным для demand с растяжением, если нормативный каталог не задаёт `Rbt`.

Дополнительно показывается характеристическая разрывная оценка резьбового сечения:

```text
Nu,characteristic = Rbun*Abn
```

Она не является допустимой рабочей нагрузкой.

Для каждого класса прочности программа должна находить первый проходящий стандартный диаметр и сохранять governing load case/node.

Подробности: [`CONNECTIONS.md`](CONNECTIONS.md).

## 13. Сварка концов рёбер

Для каждого physical member end используется один совпадающий набор:

```text
N
Vy, Vz
T
My, Mz
```

Для каждого operational load case выполняется отдельная проверка, после чего physical end получает случай с максимальной требуемой длиной.

До ввода точных координат сварных валиков используется явно обозначенная conservative circular-group surrogate:

```text
V = hypot(Vy,Vz)
M = hypot(My,Mz)
Qaxial = |N| + 2*|M|/rw
Qshear = |V| + |T|/rw
Qw = sqrt(Qaxial² + Qshear²)
```

Два расчётных сечения углового шва:

```text
Rwz = 0.45*Run
lw,f = Qw/(beta_f*kf*Rwf*gamma_c)
lw,z = Qw/(beta_z*kf*Rwz*gamma_c)
lw = max(lw,f, lw,z, 4*kf, 40 mm)
```

Расчётная длина — effective. Физическая суммарная длина:

```text
Lphysical,total = lw + 10 mm*nsegments
```

Каталог сварочных материалов хранит `Rwun/Rwf` и источник. Для рекомендации требуется как минимум:

```text
Rwun >= Run weaker parent metal
```

UI/report должны показывать критический member end, load case, `N/V/T/M`, effective/physical length и рекомендацию сварочного материала.

## 14. Боковая нагрузка вершины

Отдельный case:

```text
F0 = 1 N horizontal at top
```

Отключаются эксплуатационный ветер, лёд, собственный вес, оборудование и прочие нагрузки.

При линейности:

```text
Fmember = 1/eta_member(F0)
Fglobal = lambda_cr(F0)*1 N
Fbolt = 1/Ubolt(F0)
Flim = min(Fmember, Fglobal, Fbolt)
```

Проверяется 120° symmetry sector, default step 15°.

UI отдельно показывает `Flim`, `Fmember`, `Fglobal`, `Fbolt`, механизм и направление. Сила отображается как N/kN/kgf.

Solid-rod sanity-check сравнивает **member limit**, а не общий `Flim`, чтобы конкретный болт не подменял проверку масштаба frame solver.

## 15. Максимальная статическая масса на вершине

Gravity-only сценарий включает:

```text
self weight * deadLoadFactor
trial top mass * equipmentLoadFactor
selected intermodule bolt check
```

Исключаются ветер, лёд и horizontal loads.

На каждой итерации:

```text
U_member(m) <= 1
U_bolt(m) <= 1
lambda_cr(m) >= 1
```

Собственный вес нельзя обнулять в финальном поиске. Pure 1 kg case используется только как upper-bound reference; затем предел уточняется двоичным поиском с self weight.

UI показывает maximum total mass, remaining mass, governing mode, `Ubolt` на пределе и эквивалентный объём воды для `rho_water=1000 kg/m³`.

## 16. Verification passport

`calculateCompleteMast()` формирует structured `verification` object.

Уровень 1 — ручные формулы:

```text
a = L0/n
h = a*sqrt(2/3)
H = N*h
member count/length
m = Lsum*pi*d²/4*rho
G = m*g*gamma_g
q = rho_air*v²/2
```

Уровень 2 — equilibrium/residuals:

```text
sum(R)+sum(F) closure
global moment closure
||K*u-F||/||F|| < 1e-8
free DOF equilibrium < 1e-8
buckling residual < 1e-5
```

Уровень 3 — analytical known-answer problems:

```text
delta = F*L/(E*A)
delta = P*L³/(3*E*I)
theta = P*L²/(2*E*I)
```

Уровень 4 — cross-algorithm reference: banded vs dense linear solver и известная generalized eigen-задача `lambda_cr=2`.

Уровни 5–6 остаются `not-verified` без independent FEM, engineering review и physical validation.

Любой internal fail уровня 1–4 переводит verification status в `failed`. Если внутренние уровни зелёные, а внешние не закрыты:

```text
internal-passed-external-pending
```

Этот статус не является утверждением о безопасности реальной конструкции.

CI содержит anti-false-green regression с намеренным искажением контролируемой величины.

## 17. Solid-rod sanity-check

Для специальной геометрии:

```text
d_rib = a/2
D_solid = 2a/sqrt(3)
A6/Asolid = 9/8 = 1.125
```

Решётчатая frame-модель сравнивается со сплошной консолью по `memberLimitForceN` и linear stiffness.

Цель — обнаруживать gross errors масштаба/единиц/жёсткости/topology. Болтовый предел намеренно исключён из этого sanity-check.

## 18. Что ещё требуется для полной модели реального узла

Прототип 1.0 реализует сам болт на tension/shear/combined action и требуемую суммарную длину угловых швов. Но без дополнительных физических размеров нельзя достоверно рассчитать:

- bearing/smearing детали под болтом;
- stripping внутренней/наружной резьбы;
- фактическую длину thread engagement;
- prying/изгиб шайбы или контактной детали;
- предварительную затяжку и slip;
- точный `W/Ix/Iy` реальной сварной группы;
- finite stiffness соединения;
- fatigue;
- фундаментный тип узла.

Эти проверки должны добавляться после формализации реальной гайки/муфты/шайбы/сварных валиков. Программа не должна генерировать фиктивные значения из отсутствующей геометрии.

## 19. Бумажный расчётный проект

Autonomous HTML должен содержать:

1. method id и Git SHA;
2. resolved inputs;
3. раскрой/geometry;
4. `A/I/J/W/G`;
5. load formulas;
6. weather preset и `q`;
7. `K*u=F`;
8. governing `N/V/T/M`;
9. stress/Euler/global buckling;
10. lateral capacity с `Fbolt`;
11. static payload capacity с `Ubolt`;
12. physical joint split и `reff`;
13. выбранный bolt: `Nt/Ns/Nbt/Nbs/Ubolt/Rbun*Abn`;
14. minimum bolt by property class;
15. critical weld-end demand и required length;
16. welding consumable recommendation;
17. verification passport;
18. explicit external `NOT VERIFIED` levels;
19. diagnostics и ограничения.

Report renderer не решает FEM повторно; он форматирует готовый result object.

Бумажный проект не содержит JSON dump.

## 20. Internal CalculationSnapshot

Текущая схема:

```text
mast-calculator/calculation-snapshot/v7
```

Snapshot включает:

- method/schema/Git SHA;
- resolved parameters;
- model nodes/members/restraints;
- operational load cases;
- displacements/rotations/reactions/member results;
- global buckling;
- lateral/static payload capacity;
- full connection demands/checks/recommendations;
- weld-end envelope;
- verification levels/checks/evidence;
- diagnostics.

Snapshot не показывается пользовательской JSON-кнопкой и не встраивается в paper report.

## 21. External engineering verification

До окончательного design use требуется reference ladder:

1. beam;
2. simple spatial frame;
3. one octahedron;
4. two alternating modules;
5. full mast without wind;
6. full mast with asymmetric wind;
7. global eigen-buckling;
8. отдельный joint model с реальной bolt/weld geometry.

Для каждого external model фиксируются software/version, units, geometry, sections, restraints, loads и tolerances.

Сравниваются:

```text
u/r
reactions/reaction moments
N/V/T/M
stresses
lambda_cr/mode
joint forces and moments
```

Инженерная рецензия постановки является отдельным пунктом.

## 22. Physical validation

Предпочтительный первый этап — недеструктивные контрольные нагрузки с измерением load-deflection curve и остаточной деформации.

Испытание до разрушения/потери устойчивости не должно следовать непосредственно из UI-числа. Для него нужна отдельная безопасная программа испытаний.

## 23. CI/CD

Обязательные PR-инварианты:

- `npm test`;
- Linux/macOS/Windows matrix;
- explicit timeouts;
- least-privilege permissions;
- fresh-merge simulation;
- secret scan;
- syntax checks;
- file line-limit guard;
- static-site smoke;
- workflow policy tests;
- `verification.js` и connection browser modules входят в smoke;
- Pages deploy выполняет повторную проверку;
- Git SHA опубликованной сборки доступен report layer.

40-модульный regression дополнительно проверяет:

```text
3*(40-1) = 117 internal bolt joints
one weld-envelope item per physical member end
finite lateral bolt limit
finite static-payload bolt utilization
verification levels 1..4 PASS
```

## 24. Нормативная база

Зафиксированы:

- ГОСТ 34028-2016 — арматурный прокат;
- ГОСТ ISO 898-1-2014 — болты, винты и шпильки;
- ГОСТ 24705-2004 — метрическая резьба;
- СП 16.13330.2017, актуальная применяемая редакция — стальные конструкции и соединения;
- ГОСТ 5264-80 — ручная дуговая сварка;
- ГОСТ 9467-75 — покрытые электроды;
- СП 20.13330.2016 — нагрузки и воздействия;
- ГОСТ 27751-2014 — надёжность конструкций.

Упоминание документа не означает реализацию всех его возможных проверок; реализованная область указана явно в `CONNECTIONS.md`.

## 25. Следующие инженерные этапы

После 1.0 приоритетны:

1. выполнить external FEM cross-check;
2. получить engineering review paper calculation project;
3. измерить/зафиксировать реальную geometry гайки, шайбы, thread engagement и сварных валиков;
4. добавить thread stripping, bearing, prying и exact weld-group `W/Ix/Iy`;
5. добавить нормативные load combinations;
6. добавить P-Delta/geometric nonlinearity/imperfections;
7. развить foundation model;
8. подготовить physical validation protocol.

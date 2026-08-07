# Требования к Mast Calculator

Статус: рабочая спецификация прототипа 0.9.

Подробные специализированные документы:

- [`CALCULATION_ARCHITECTURE.md`](CALCULATION_ARCHITECTURE.md) — FEM и численный solver;
- [`VERIFICATION_FOR_NON_SPECIALISTS.md`](VERIFICATION_FOR_NON_SPECIALISTS.md) — пошаговая верификация issue #12;
- [`LATERAL_CAPACITY_WEATHER_VALIDATION.md`](LATERAL_CAPACITY_WEATHER_VALIDATION.md) — боковая нагрузка, погода и solid-rod sanity-check;
- [`STATIC_PAYLOAD_CAPACITY.md`](STATIC_PAYLOAD_CAPACITY.md) — вертикальная масса вершины;
- [`PERFORMANCE_AND_PROGRESS.md`](PERFORMANCE_AND_PROGRESS.md) — performance/Worker;
- [`CI_CD_REVIEW.md`](CI_CD_REVIEW.md) — CI/CD.

## 1. Цель и границы продукта

Mast Calculator — статическое браузерное приложение для расчёта и последующей оптимизации модульной мачты из одинаковых арматурных октаэдров.

Обязательные принципы:

1. backend не требуется; приложение должно публиковаться на GitHub Pages;
2. пользовательский ввод ориентирован на изготовителя, а не на внутренние FEM-параметры;
3. глобальный расчёт каркаса отделён от будущего расчёта физических болтовых/резьбовых/сварных узлов;
4. расчётное ядро должно иметь аналитические, инвариантные, reference и regression checks;
5. результат должен быть воспроизводимым и связан с Git SHA расчётного кода;
6. пользователь получает человекочитаемый расчётный проект с формулами и численными подстановками;
7. программа должна показывать не только результат, но и **границу доказанности результата**;
8. расчётные изменения проходят CI на Linux/macOS/Windows.

Прототип не является сертификатом конструкции и не должен скрывать отсутствующие нормативные/внешние проверки.

## 2. Практический ввод

Пользователь задаёт:

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
advanced safety/load factors and limits
```

Пользователь не вводит вручную:

```text
ribCutLengthMm
moduleHeightMm
E, nu, Ry, Rm, steel density
effectiveLengthFactor текущей fixed-fixed идеализации
```

Эти величины вычисляются или берутся из централизованного каталога.

## 3. Геометрия правильного октаэдра

До учёта kerf/trim/joint overlap:

```text
a = Lstock/nparts
R = a/sqrt(3)
h = a*sqrt(2/3)
H = Nmodules*h
```

Нижняя и верхняя треугольные грани имеют сторону `a` и повёрнуты на 60°.

Один модуль должен содержать:

```text
3 horizontal members
6 diagonal members
= 9 members
```

Если замкнут верхний треугольник, модель имеет дополнительно 3 верхних member.

Regression invariant: фактическая геометрическая длина каждого member должна совпадать с `a` в установленном численном допуске.

Пока отдельно не моделируются:

- ширина реза;
- торцевая подрезка;
- заход/нахлёст арматуры на узел;
- дополнительная высота гайки/болта;
- эксцентриситет расчётных осей внутри физического узла.

## 4. Глобальная 3D frame-модель

Основной вопрос global solver:

> выдерживает ли арматурный каркас нагрузки, если все пересечения считать идеальными, абсолютно жёсткими и неразрушаемыми?

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

Member должен передавать и возвращать:

```text
N
Vy, Vz
T
My, Mz
```

Три нижних узла текущей модели полностью заделаны по 6 DOF. Реальный фундамент должен быть отдельным будущим модулем.

## 5. Нагрузки

Эксплуатационный расчёт поддерживает:

- собственный вес стали;
- цилиндрический слой льда;
- ветер на пространственно ориентированные круглые members;
- массу оборудования;
- ветер на оборудование;
- дополнительную горизонтальную силу;
- дополнительную вертикальную силу;
- огибающую по направлениям ветра.

Собственный вес, лёд и ветер на member задаются distributed element loads.

Для равномерной transverse load consistent nodal load vector должен учитывать силы `qL/2` и конечные моменты `qL²/12`.

Для цилиндрического member используется только нормальная к его оси компонента ветра.

## 6. Погодные сценарии

UI должен поддерживать:

- полный Beaufort 0–12;
- пользовательский ввод `windPressurePa`.

Для preset:

```text
q = rho_air*v²/2
rho_air = 1.225 kg/m³
```

Beaufort presets — сравнительный UX-инструмент, не замена нормативному ветровому районированию и сочетаниям СП 20.

## 7. Проверка member

Упругая проверка:

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

Для distributed transverse load нельзя терять возможный максимум момента внутри элемента.

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

Это текущая инженерная упругая проверка, а не полный нормативный member design по СП 16.

## 8. Общая линейная устойчивость

После static solve формируется `KG` и решается:

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

Рабочий matrix-free generalized Lanczos обязан подтверждать найденный результат невязкой исходного generalized equation.

Не реализованы пока:

- P-Delta;
- geometric nonlinearity;
- initial imperfections;
- пластичность.

## 9. Производительность

Для одной геометрии должно выполняться `compile once, solve many`:

```text
geometry/transforms
free DOF map
banded K
Cholesky(K) once
```

Все operational/lateral/static-payload cases используют одну факторизацию `K`.

40-модульный regression invariant текущей топологии:

```text
720 free DOF
half-bandwidth <= 35
stiffnessFactorizationCount = 1
```

Тяжёлый browser calculation выполняется в Web Worker. UI должен иметь progress, elapsed time, ETA и немедленную отмену через termination Worker.

## 10. Боковая нагрузка вершины

Отдельный проверочный case:

```text
F0 = 1 N horizontal at top
```

Сила делится между тремя top nodes. Для чистоты экспериментальной характеристики отключаются эксплуатационный ветер, лёд, собственный вес, оборудование и прочие нагрузки.

При линейности:

```text
Fmember = 1/eta_member(F0)
Fglobal = lambda_cr(F0)*1 N
Flim = min(Fmember, Fglobal)
```

Проверяется 120° symmetry sector с настраиваемым шагом, default 15°.

UI отдельно показывает `Flim`, `Fmember`, `Fglobal`, механизм, направление и критический member. Сила отображается как N/kN/kgf; нельзя называть kgf просто «кг».

## 11. Максимальная статическая масса на вершине

Отдельный gravity-only сценарий нужен для задач типа резервуара воды.

Включаются:

```text
self weight * deadLoadFactor
trial top mass * equipmentLoadFactor
```

Исключаются ветер, лёд и горизонтальные нагрузки.

Для trial mass:

```text
Pnom = m*g
Pdesign = m*g*equipmentLoadFactor
```

На каждой итерации должны выполняться:

```text
U_member(m) <= 1
lambda_cr(m) >= 1
```

Собственный вес нельзя обнулять в финальном поиске. Pure 1 kg case допускается только как верхняя оценка, затем предел уточняется двоичным поиском с self weight.

UI показывает:

- maximum total top mass, kg;
- remaining mass after configured vertical loads;
- governing mode;
- equivalent water volume for `rho_water=1000 kg/m³`.

## 12. Verification passport для неспециалиста

Это обязательное требование issue #12.

Программа не должна выдавать простой самопровозглашённый статус «расчёт верен». Вместо этого `calculateCompleteMast()` формирует структурированный `verification` object с независимыми уровнями.

### 12.1. Уровень 1 — ручной калькулятор

Для текущей модели автоматически проверяются и показываются с подстановками:

```text
a = L0/n
h = a*sqrt(2/3)
H = N*h
member count
actual geometric length of every member
m = Lsum*pi*d²/4*rho
G = m*g*gamma_g
q = rho_air*v²/2
```

Каждый check должен иметь текст `howToCheck` для неспециалиста.

### 12.2. Уровень 2 — equilibrium/residuals

Минимальный набор:

```text
sum(R)+sum(F) closure
global moment closure
||K*u-F||/||F|| < 1e-8
free DOF equilibrium < 1e-8
buckling residual < 1e-5
```

### 12.3. Уровень 3 — analytical known-answer problems

Тем же production `analyzeFrame()` должны решаться минимум:

```text
delta = F*L/(E*A)
delta = P*L³/(3*E*I)
theta = P*L²/(2*E*I)
```

В verification object сохраняются expected, actual, tolerance и relative error.

### 12.4. Уровень 4 — cross-algorithm reference

Оптимизированный linear solver проверяется отдельным dense Gaussian solver на одной малой SPD-задаче.

Eigen solver проверяется на задаче с известным ответом и отдельным dense reference. Минимальный benchmark:

```text
K = diag(2,8)
KG = diag(-1,-2)
lambda_cr = 2
```

### 12.5. Уровни 5–6 не могут становиться зелёными автоматически

Статус должен оставаться `not-verified`, пока нет внешнего артефакта:

- independent FEM model/result;
- engineering review;
- physical validation.

Программа не имеет права приравнивать собственные unit tests к независимой validation реальной конструкции.

### 12.6. Сводный статус

Минимальные состояния:

```text
pass
fail
not-verified
```

Если любой internal check уровня 1–4 падает, verification status должен стать `failed`.

Если уровни 1–4 проходят, а внешние уровни ещё не закрыты:

```text
internal-passed-external-pending
```

Этот статус **не является утверждением о безопасности реальной конструкции**.

### 12.7. Anti-false-green regression

CI обязан содержать отрицательный тест: намеренно изменить контролируемое рассчитанное значение и проверить, что соответствующий verification check переходит в `FAIL`.

40-модульный regression должен требовать:

```text
verification.failed = 0
levels 1..4 = PASS
```

Подробный подход: [`VERIFICATION_FOR_NON_SPECIALISTS.md`](VERIFICATION_FOR_NON_SPECIALISTS.md).

## 13. Solid-rod sanity-check

Для специальной геометрии:

```text
d_rib = a/2
D_solid = 2a/sqrt(3)
A6/Asolid = 9/8 = 1.125
```

решётчатая мачта сравнивается со сплошной консолью по порядку боковой предельной силы и linear stiffness.

Цель — обнаруживать gross errors масштаба/единиц/жёсткости/топологии, а не утверждать эквивалентность двух разных конструкций.

## 14. Реальные соединительные узлы

Будущий joint module должен получать связанный demand одного физического load case:

```text
N
Vy
Vz
T
My
Mz
loadCaseId
```

Запрещено создавать несуществующий demand vector из независимых максимумов разных cases.

Будущий расчёт должен учитывать болт/шпильку, резьбу, length of engagement, nut, bearing, weld group, parent metal, eccentricity и сварочный материал.

Результат joint check:

```text
PASS/FAIL
demand
resistance
utilization
governing failure mode
fastener/weld specification
source/revision
```

## 15. Бумажный расчётный проект

Пользовательский autonomous HTML предназначен для чтения инженером и печати/PDF.

Он должен содержать:

1. method id и Git SHA;
2. resolved inputs;
3. раскрой и geometry;
4. `A/I/J/W/G`;
5. load formulas;
6. weather preset и `q`;
7. frame equation `K*u=F`;
8. governing `N/V/T/M`;
9. stress/Euler checks;
10. global eigen-buckling;
11. lateral capacity;
12. static top payload capacity;
13. **verification passport с formula/substitution/expected/actual/howToCheck**;
14. explicit external `NOT VERIFIED` levels;
15. diagnostics и ограничения.

Report renderer не имеет права повторно решать FEM. Он только форматирует уже рассчитанный result object.

Бумажный проект не содержит JSON dump.

## 16. Internal CalculationSnapshot

Текущая схема:

```text
mast-calculator/calculation-snapshot/v6
```

Snapshot нужен для regression/cross-check/debug и должен включать:

- method/schema/Git SHA;
- resolved parameters;
- model nodes/members/restraints;
- operational load cases;
- displacements/rotations/reactions/member results;
- global buckling;
- lateral capacity;
- static payload capacity;
- verification levels/checks/evidence;
- diagnostics.

Snapshot не показывается пользовательской JSON-кнопкой и не встраивается в paper report.

## 17. Independent engineering verification protocol

До окончательного design use требуется external reference ladder:

1. beam;
2. simple spatial frame;
3. one octahedron;
4. two alternating modules;
5. full mast without wind;
6. full mast with asymmetric wind;
7. global eigen-buckling.

Для каждого external model фиксируются software/version, units, geometry, sections, restraints, loads и tolerances.

Сравниваются:

```text
u/r
reactions/reaction moments
N/V/T/M
stresses
lambda_cr/mode
```

Инженерная рецензия постановки является отдельным пунктом и не заменяется совпадением двух программ.

## 18. Physical validation

Предпочтительный первый этап — недеструктивные контрольные нагрузки с измерением load-deflection curve и остаточной деформации.

Испытание до разрушения/потери устойчивости не должно следовать непосредственно из UI-числа. Оно требует отдельной безопасной программы испытаний, дистанционного нагружения и исключения людей из зоны возможного падения/разрушения.

## 19. CI/CD

Обязательные инварианты PR:

- `npm test`;
- Linux/macOS/Windows matrix;
- explicit job timeouts;
- least-privilege permissions;
- fresh-merge simulation с актуальным `main`;
- secret scan;
- syntax checks;
- file line-limit guard;
- static-site smoke;
- workflow policy tests;
- `verification.js` входит в browser smoke;
- Pages deploy выполняет повторную проверку перед публикацией;
- writer deployment не отменяется новым push посередине;
- Git SHA опубликованной сборки доступен report layer.

## 20. Нормативная база и источники

Зафиксированы как текущие/будущие источники:

- ГОСТ 34028-2016 — арматурный прокат;
- ГОСТ ISO 898-1-2014 — болты, винты и шпильки;
- ГОСТ 24705-2004 — метрическая резьба;
- СП 16.13330.2017 — стальные конструкции и соединения;
- ГОСТ 5264-80 — ручная дуговая сварка;
- ГОСТ 9467-75 — покрытые электроды;
- СП 20.13330.2016 — нагрузки и воздействия;
- ГОСТ 27751-2014 — надёжность конструкций.

Упоминание документа не означает, что прототип уже реализует все его нормативные проверки.

## 21. Следующие инженерные этапы

После 0.9 приоритетны:

1. реально выполнить external FEM cross-check и превратить часть level 5 из `not-verified` в подтверждённый артефакт;
2. получить инженерную рецензию paper calculation project;
3. формализовать физическую geometry соединительного узла;
4. реализовать bolt/thread/nut/weld checks;
5. добавить нормативные load combinations;
6. добавить P-Delta/geometric nonlinearity/imperfections;
7. развить параметрический foundation model;
8. подготовить контролируемый physical validation protocol.

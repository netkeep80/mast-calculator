# Архитектура расчётного ядра

Статус: архитектура прототипа **1.2**.

Документ фиксирует границы между практическим вводом, геометрией мачты, тремя путями статического расчёта, общей устойчивостью, физическим конфигуратором соединений, предельными расчётами, Web Worker и отчётностью.

## 1. Главный поток данных

```text
Практический ввод
  арматура / раскрой / материал
  ветер / лёд / оборудование
  auto | manual конфигуратор узла
        |
        v
resolveCalculationParameters()
  a = Lstock/nparts
  h = a*sqrt(2/3)
        |
        v
generateMastModel()
  N одинаковых октаэдров ножками вниз
  3 top-ring + 6 leg = 9 members/module
        |
        +-------------------------------+
        |                               |
        v                               v
compileFrameSystem()              compileModuleStack()
  global banded K                   module K 36x36
  Cholesky(K)                       Schur 18-DOF interfaces
        |                               |
        +----------- load case ----------+
        |                               |
        v                               v
global solve K*u=F              module top-down/bottom-up
        |                               |
        +---------- cross-check ----------+
        |
        v
member N/V/T/M + reactions + KG
        |
        +----> global eigen-buckling
        |
        v
raw intermodule resultants F/M
        |
        v
configureIntermoduleJoint()
  bolt
  clearance nut with 2 ribs
  long coupling nut with 4 ribs
  bolt length / engagement / reff
  weld consumable / weld leg
        |
        v
FIX physical joint
        |
        +----> lateral capacity
        +----> static top payload
        +----> maximum height search
        |
        v
verification / UI / CSV / paper project / snapshot
```

## 2. Геометрия физического модуля

Каждый модуль — правильный октаэдр, установленный ножками вниз.

```text
bottom interface = 3 node
upper interface  = 3 node
members          = 6 leg + 3 top-ring
```

Для `N` модулей:

```text
levels  = N + 1
nodes   = 3*(N+1)
members = 9*N
```

Соседние уровни повернуты на 60°.

До учёта kerf/trim/joint overlap:

```text
a = Lstock/nparts
R = a/sqrt(3)
h = a*sqrt(2/3)
H = N*h
```

Все девять рёбер одного правильного модуля имеют длину `a`.

## 3. Граничные условия

Три нижних узла первого модуля полностью заделаны:

```text
ux = uy = uz = rx = ry = rz = 0
```

Это идеальная фундаментная граница. Реальная жёсткость свай/швеллеров пока не моделируется.

## 4. Пространственный frame element

Каждый узел имеет:

```text
q = [ux, uy, uz, rx, ry, rz]
```

Каждое ребро — 12-DOF Euler–Bernoulli spatial frame element.

Для круглой сплошной арматуры:

```text
A = pi*d^2/4
Iy = Iz = pi*d^4/64
J = pi*d^4/32
W = pi*d^3/32
G = E/[2*(1+nu)]
```

Локальная матрица содержит:

```text
EA/L
GJ/L
12EI/L^3
6EI/L^2
4EI/L
2EI/L
```

Глобальная матрица элемента:

```text
Ke = T^T * ke * T
```

Узлы в global FEM не имеют moment release: арматурный каркас идеализирован как сваренный жёстко.

## 5. Нагрузки

`buildLoadCase()` возвращает:

```text
nodalLoads[nodeId]
nodalMoments[nodeId]
memberDistributedLoads[memberId]
```

Поддерживаются:

- собственный вес;
- лёд;
- пространственный ветер;
- масса и парусность оборудования;
- дополнительная горизонтальная сила;
- дополнительная вертикальная сила;
- огибающая ветровых направлений.

Для uniform distributed load consistent vector содержит `qL/2` и `qL²/12`.

## 6. Production global solver

`compileFrameSystem()` создаёт один раз для геометрии:

```text
member geometry
local axes / transforms
free DOF map
symmetric band K
Cholesky(K)
total mass
```

Production static solve:

```text
K*u = F
```

После решения восстанавливаются:

```text
ux,uy,uz,rx,ry,rz
reactions/reaction moments
N,Vy,Vz,T,My,Mz на обоих концах каждого member
```

При level-order numbering current topology даёт малую полуширину band matrix.

## 7. Exact module Schur solver

Один physical module имеет 36 DOF:

```text
bottom interface = 18 DOF
top interface    = 18 DOF
```

Module equation:

```text
[ Kbb Kbt ] [ub] = [fb]
[ Ktb Ktt ] [ut]   [ft]
```

Already processed upper stack задаётся `(Supper,pupper)`.

Top-down condensation:

```text
A = Ktt + Supper
S = Kbb - Kbt*A^-1*Ktb
p = fb - Kbt*A^-1*(ft+pupper)
```

На rigid foundation известно `u0=0`, после чего выполняется bottom-up recovery:

```text
ut = A^-1*(ft+pupper-Ktb*ub)
```

Это точная линейная substructuring текущей FEM, а не суммирование только сил.

## 8. Global ↔ module cross-check

Для каждого operational load case сравниваются все DOF:

```text
||u_module-u_global|| / ||u_global|| < 1e-8
```

На каждом общем интерфейсе проверяются силы и моменты:

```text
Ftop,lower + Fbottom,upper = 0
Mtop,lower + Mbottom,upper = 0
```

Normalized interface residual также должен быть `<1e-8`.

## 9. Третий независимый reference solver

`site/engine/reference-frame.js` является verification-only реализацией.

Он намеренно не импортирует production:

```text
solver.js
module-stack.js
banded.js
```

Отдельно реализованы:

```text
local axes
12x12 element stiffness
consistent distributed load
full dense K assembly
DOF reduction
dense Gaussian elimination with pivoting
member force recovery
reactions
dense KG / reference buckling
```

Он нужен как CI oracle, а не как браузерный production solver.

Dedicated `Triple FEM equivalence` сравнивает global, Schur и dense reference на наборе мачт 1…12 modules с различными нагрузками.

## 10. Member strength layer

По восстановленным coincident actions:

```text
sigma_N = |N|/A
sigma_M = M/W
tau_T = T*(d/2)/J
tau_V = 4V/(3A)
sigma_eq = sqrt((sigma_N+sigma_M)^2 + 3*(tau_T^2+tau_V^2))
```

Current material check:

```text
Ustress = sigma_eq/(Ry/gamma_M)
```

Local elastic Euler check:

```text
Leff = 0.5*L
NE = pi^2*E*I/Leff^2/gamma_M
UEuler = Ncompression/NE
Umember = max(Ustress,UEuler)
```

## 11. Общая линейная устойчивость

После static solve строится `KG` и решается:

```text
(K + lambda*KG)*phi = 0
```

Production использует matrix-free generalized Lanczos в `K`-inner product и проверяет residual исходного generalized equation.

Общая buckling mode остаётся свойством полной мачты и не заменяется независимыми module checks.

## 12. Raw demand физического узла

Важное изменение 1.2: сначала connection layer извлекает **сырые совпадающие результирующие** двух рёбер верхней ножки:

```text
Fjoint = F1 + F2
Mjoint = M1 + M2
```

Они сохраняют `loadCase`, `windDirection`, `nodeId`, `level`.

Только после выбора конкретной геометрии болта/гаек эти raw resultants переводятся в bolt demand. Это позволяет каждому кандидату иметь собственный `reff`.

## 13. Physical joint hardware model

Реальная топология:

```text
upper module leg:
  2 ribs -> regular clearance nut My
                    |
                    | bolt Mx passes freely
                    v
lower module top node:
  4 ribs -> long coupling nut Mx
                    ^
                    | bolt Mx screws into thread
```

`site/engine/joint-hardware-catalog.js` хранит reference geometry гаек, стандартные длины болтов, engagement presets и weld options.

Свободный проход проверяется по базовому minor diameter:

```text
D1 = D - 1.082532*P
D1 - dbolt >= 0.5 mm
```

Long coupling nut имеет ту же резьбу, что болт. Reference geometry для M16…M36 использует длину `3d`.

## 14. Производные параметры узла

Пользователь больше не вводит искусственный effective radius.

```text
reff = s/2
```

где `s` — across-flats длинной соединительной гайки.

Default thread engagement:

```text
Lengagement = 2d
nturns = Lengagement/P
```

Минимальная длина болта:

```text
Lrequired = m(clearance nut) + Lengagement + 2 mm
```

Затем выбирается ближайшая большая standard length.

Reference M24 assembly:

```text
bolt M24
clearance nut M30
coupling nut M24x72
engagement 48 mm = 16 turns
required 75.6 mm
selected bolt length 80 mm
reff = 18 mm
```

## 15. Auto/manual configurator

`configureIntermoduleJoint()` имеет два режима.

### Auto

Для каждого supported bolt candidate:

```text
candidate bolt
-> candidate clearance nut
-> candidate coupling nut
-> candidate reff
-> split raw F/M into Nt/Ns
-> bolt capacity
-> geometry checks
```

Поиск начинает с property class 8.8 и минимального проходящего standard diameter; если весь ряд не проходит, повышает класс.

Также выбираются compatible electrode, weld leg и segment count.

### Manual

Пользователь выбирает discrete physical parameters из dropdown. Derivable geometry остаётся readonly. Ручной выбор не заменяется автоматически.

## 16. Bolt demand/capacity

Для vertical bolt axis:

```text
Faxis = Fjoint dot eb
Fperp = Fjoint - eb*Faxis
T  = |Mjoint dot eb|
Mb = |Mjoint - eb*(Mjoint dot eb)|
```

Сжатие контакта не является растяжением болта:

```text
Ndirect = max(0,-Faxis)
Nt = Ndirect + |Mb|/reff
Ns = |Fperp| + |T|/reff
```

Capacity:

```text
Nbs = Rbs*Ab*ns*gamma_b*gamma_c
Nbt = Rbt*Abn*gamma_c
Ubolt = sqrt((Ns/Nbs)^2 + (Nt/Nbt)^2)
```

Geometry pass и strength pass обязательны одновременно.

## 17. Weld layer

Каждый конец каждого ребра проверяется по coincident `N/V/T/M`.

Current surrogate:

```text
Qaxial = |N| + 2|M|/rw
Qshear = |V| + |T|/rw
Qw = hypot(Qaxial,Qshear)

lw,f = Qw/(beta_f*kf*Rwf*gamma_c)
lw,z = Qw/(beta_z*kf*Rwz*gamma_c)
lw = max(lw,f,lw,z,4kf,40mm)
Lphysical = lw + 10mm*nsegments
```

Auto mode выбирает базовый compatible electrode и standard weld inputs, но фактическая weld check всё равно обязательна.

## 18. Почему узел фиксируется перед capacity search

Если auto configurator повторно запускать внутри каждого trial load, он мог бы незаметно увеличивать bolt и тем самым измерять не несущую способность конкретной конструкции, а способность конфигуратора бесконечно менять изделие.

Поэтому user-facing `calculateCompleteMastWithConfiguredJoint()` делает:

```text
1. operational calculation
2. configure actual joint
3. freeze resolved physical parameters
4. lateral capacity with frozen joint
5. static payload with frozen joint
6. maximum height with frozen joint
```

Это обязательный invariant прототипа 1.2.

## 19. Lateral capacity

Clean unit-load scenario:

```text
F0 = 1 N horizontal at top
Fmember = 1/Umember(F0)
Fglobal = lambda_cr(F0)*1N
Fbolt = 1/Ubolt(F0)
Flim = min(Fmember,Fglobal,Fbolt)
```

`Fbolt` относится к уже выбранной physical assembly.

## 20. Static top payload

Gravity-only search сохраняет self weight:

```text
Pdesign = m*g*gamma_payload
Umember(m)
Ubolt(m)
lambda_cr(m)
```

Pass:

```text
Umember<=1
Ubolt<=1
lambda_cr>=1
```

Здесь также используется frozen physical joint.

## 21. Maximum height

Candidate определяется целым количеством одинаковых modules:

```text
H(N)=N*h
```

Design criteria:

```text
Umember<=1
Ubolt<=1
lambda_cr>=minimumBucklingFactor
delta_top<=displacementLimit
```

Ultimate criteria:

```text
Umember<=1
Ubolt<=1
lambda_cr>=1
```

Search: exponential bracketing → binary search → local integer neighbourhood.

## 22. Rebar + joint optimization

`selectUniformDiameter()` перебирает standard rebar diameter по возрастанию.

В auto mode каждый вариант получает собственный согласованный physical joint. Вариант проходит только если одновременно:

```text
passesStrength
passesDisplacement
passesBuckling
passesConnection
```

Поэтому кнопка «Подобрать арматуру и узел» действительно подбирает комплект, а не только арматуру.

## 23. Web Worker boundary

Main thread отвечает за UI и canvas.

Heavy calculation работает в module Worker:

```text
app-bootstrap.js
    -> enrich physical joint UI parameters
app.js
    -> Worker(calculation-worker.js)
calculation-worker.js
    -> calculateCompleteMastWithConfiguredJoint()
```

`app-bootstrap.js` устанавливается до импорта legacy UI-controller `app.js`, добавляет dropdown/3D-joint integration и передаёт новые discrete parameters в Worker.

Cancel выполняется через `worker.terminate()`.

## 24. Визуализация

Три canvas имеют разные задачи:

```text
viewer.js          -> вся мачта и выбор module
module-viewer.js   -> selected module, N/V/M, interface actions
joint-viewer.js    -> two-nut physical joint, bolt, engagement, 4+2 ribs
```

`joint-viewer.js` является schematic 3D visualization, не CAD model thread/weld geometry.

## 25. Отчётность

Report renderer не решает FEM повторно.

Бумажный проект получает уже рассчитанный `result` и показывает:

```text
actual bolt diameter/class/length
clearance nut
long coupling nut
thread engagement / turns
reff
bolt demand/capacity
weld demand
module/global/height/verification data
```

Internal snapshot v8 сохраняет весь `connections.configurator` object для воспроизводимости. Schema number не менялся, потому что структура расширена обратносуместимыми полями внутри существующего connections block.

## 26. Verification boundaries

Internal verification включает:

- аналитические frame benchmarks;
- force/moment equilibrium;
- global ↔ Schur comparison;
- dense independent numerical reference;
- physical joint catalogue/configuration regressions.

При этом остаются `NOT VERIFIED`:

```text
external FEM
engineering review
physical test
```

Внутренний третий solver не называется внешней экспертизой.

## 27. Performance invariants

Production global path остаётся banded и factorizes `K` один раз на geometry.

Module solver использует маленькие 18x18 interface factorizations.

Dense third solver запускается только в CI reference cases.

Joint auto-selection перебирает небольшой конечный catalogue и не создаёт dense global inverse.

Height search обязан использовать bracket/binary strategy.

## 28. Открытые физические слои

Архитектура 1.2 намеренно пока не включает:

```text
P-Delta / geometric nonlinearity
initial imperfections
plasticity
finite contact/joint stiffness
thread stripping by actual nut material
actual thread tolerances/coatings
bearing/prying/preload/slip
exact weld bead coordinates
fatigue
parameterized foundation
complete normative load combinations
external FEM validation
```

При добавлении nonlinear effects текущая linear Schur condensation должна быть заменена/развита до incremental nonlinear substructuring.

# Архитектура расчётного ядра

Статус: актуальная архитектура прототипа **1.4** после issues #33 и #36.

## 1. Поток данных

```text
user input / scenario
        ↓
resolve material + weather + exact octahedron geometry
        ↓
generate physical 9-member modules
        ↓
compile global frame system + module stack
        ↓
operational load cases
  user loads: weather/ice/top mass/top wind area
  internal fixtures: separate topPointLoadN API
        ↓
┌─────────────────────────┐
│ global banded FEM       │
│ exact module Schur      │ <- runtime cross-check
└─────────────────────────┘
        ↓
member N/V/T/M + modular interface actions
        ↓
connection configurator
  geometry + nut net area + preload + bolt tension/shear + weld
        ↓
fix selected physical joint
        ↓
┌──────────────────┬──────────────────┬──────────────────┬────────────────┐
│ pure lateral ref │ static top mass  │ horizontal boom  │ maximum height │
│ no self-weight   │ + additional kg  │ self-weight+load │                │
└──────────────────┴──────────────────┴──────────────────┴────────────────┘
        ↓
verification / report / snapshot v9 / UI / reference audit
```

Independent dense FEM находится в test/verification path и не участвует в обычном browser calculation.

## 2. Геометрия

Физический модуль — правильный октаэдр ножками вниз:

```text
edge a = Lstock/nparts
1 <= nparts <= 48, integer
R = a/sqrt(3)
h = a*sqrt(2/3)
3 top-ring + 6 leg = 9 members/module
```

Уровни чередуются на 60°. Геометрия не имеет специального `closeTopRing`: верхний треугольник принадлежит последнему физическому модулю.

## 3. Frame element

Node DOF:

```text
ux,uy,uz,rx,ry,rz
```

Member — 12-DOF 3D Euler–Bernoulli frame. Для круглого сечения вычисляются `EA, EIy, EIz, GJ`. Member loads self-weight/ice/wind задаются distributed и переходят в consistent local nodal vector.

После solve восстанавливаются local end forces:

```text
[N,Vy,Vz,T,My,Mz]A
[N,Vy,Vz,T,My,Mz]B
```

## 4. Production global solver

`compileFrameSystem()` строит symmetric band stiffness и factorizes один раз на геометрию. Несколько load cases используют одну факторизацию.

```text
K*u = F
```

Контролируются residual, free-DOF equilibrium, force/moment equilibrium и conditioning diagnostics.

## 5. Production load layer — issue #36

Пользовательская модель нагрузки намеренно не содержит произвольных `extraHorizontalLoadN`/`extraVerticalLoadN`.

Operational inputs:

```text
self weight
ice
wind on members
equipmentMassKg
equipmentWindAreaM2
weather/wind direction envelope
```

Top equipment weight:

```text
Wequipment = equipmentMassKg*g*equipmentLoadFactor
```

Если старый parameter object содержит `extraHorizontalLoadN` или `extraVerticalLoadN`, `buildLoadCase()` их не читает.

Для verification/special capacity задач существует отдельный внутренний API:

```text
buildLoadCase(model, parameters, {
  topPointLoadN: [Fx,Fy,Fz]
})
```

Так test fixture не становится пользовательским параметром и не создаёт второй способ задания той же физической нагрузки.

## 6. Module Schur solver

Один модуль имеет 36 interface DOF:

```text
bottom 18
top 18
```

Top-down:

```text
A = Ktt+Supper
S = Kbb-Kbt*A^-1*Ktb
p = fb-Kbt*A^-1*(ft+pupper)
```

Bottom-up:

```text
ut = A^-1*(ft+pupper-Ktb*ub)
```

Результат — тот же linear system, но другой assembly/solution path. Runtime сравнивает полный displacement/rotation vector с global FEM и баланс общих interfaces.

### Верхняя грань issue #32

В modular result различаются:

```text
topStructuralFromAbove
topDirectApplied
topAppliedFromAbove = structural + direct
```

`Kmodule*u-fmodule` даёт structural action соседней конструкции; direct nodal load уже находится в `fmodule`, поэтому его нельзя терять в пользовательском результате. Interface closure соседних модулей использует structural action, чтобы direct load не удваивался.

## 7. Independent dense reference FEM

Отдельная implementation самостоятельно собирает element matrices/load vectors, full dense `K`, решает Gaussian elimination и восстанавливает reactions/end forces. Она не импортирует production band solver или module stack.

CI сравнивает global ↔ Schur ↔ dense по DOF, reactions и 12 end-force components. Ранее использовавшиеся `extra...` test inputs переведены на внутренний `topPointLoadN`, поэтому numerical cross-check не потерял боковые/вертикальные fixture cases после issue #36.

## 8. Member design checks

Elastic von Mises + local Euler:

```text
Ustress = sigma_eq/(Ry/gamma_M)
UEuler = Ncompression/NE
Umember = max(Ustress,UEuler)
```

Это current engineering model, не полный нормативный SP16 member curve.

## 9. Global eigen-buckling

```text
(K + lambda*KG)*phi = 0
```

`KG` строится из текущего compression state. Production solver — matrix-free generalized Lanczos с eigen residual. Global buckling остаётся полной связанной задачей; Schur static decomposition её не заменяет.

## 10. Connection-layer

Global frame joints остаются ideal-rigid. Реальная двухгаечная сборка проверяется после FEM.

Topology:

```text
upper module: 2 ribs -> clearance nut My
vertical bolt Mx passes through My
lower module: 4 ribs -> coupling nut Mx
bolt screws into coupling nut
```

`joint-configurator.js` строит geometry каждого candidate. `joint-demand.js` переводит coincident upper-rib resultants в bolt-axis components. `connection-check.js` объединяет bolt/nut/weld checks.

## 11. Nut geometry and net section — issue #33

Hardware geometry проверяет свободный проход, engagement и bolt length.

```text
Ahex = sqrt(3)/2*s²
Anet = Ahex-pi*D1²/4
Arib = pi*dbar²/4
Anet/Arib >= ksection >= 2
```

`joint-section-check.js` проверяет обе гайки. Недостаточная площадь делает candidate invalid и блокирует fixed-joint capacity cases, где межмодульный узел существует.

## 12. Bolt demand and oblique shear

Для resultants двух upper ribs:

```text
Faxis = F*eb
Fperp = F-eb(F*eb)
Nt,direct=max(0,-Faxis)
Ns,direct=|Fperp|
reff=s/2
Nt,external=Nt,direct+|Mb|/reff
Ns=Ns,direct+|T|/reff
```

`directShearN`/`shearFromInclinedForceN` публикуется отдельно.

## 13. Torque preload — issue #33

```text
F0,nom=T/(K*d)
F0,max=(1+Gamma)*F0,nom
F0,min=(1-Gamma)*F0,nom
Nt,strength=F0,max+Nt,external

Nbs=Rbs*Ab*ns*gamma_c
Nbt=Rbt*Abn*gamma_c
Ubolt=hypot(Ns/Nbs,Nt,strength/Nbt)
```

Project defaults: `T=200 N*m`, `K=0.20`, `Gamma=0.25`. Model conservative: external separating load полностью добавляется к max preload, friction-grip relief не кредитуется.

## 14. Weld-layer and area reserve — issue #33

Coincident member-end `N/V/T/M` входит в circular weld-group surrogate.

```text
teff=beta_f*kf
Aeff=teff*lweff
Aeff>=kweld*Arib
2<=kweld<=3
default=2.5
```

`calculateMinimumWeldLength()` возвращает максимум force-based, minimum-length и area-based requirements. `2–3×` является project criterion.

## 15. Auto-configurator and fixed physical joint

Для каждого bolt candidate:

```text
hardware geometry
→ nut net-section
→ recompute reff
→ decompose demand
→ torque preload
→ bolt interaction
```

После operational cases выбранные детали freeze и переиспользуются для pure lateral, static top mass, horizontal boom и height trial calculations. Trial case не может незаметно увеличить соединение.

## 16. Pure lateral reference — issue #36

`lateral-capacity.js` решает нормированную проверочную задачу:

```text
F0=1 Н horizontal
self weight=0
wind=0
ice=0
equipment=0
```

Из unit cases получаются независимые envelopes:

```text
Fmember
Fglobal
Fbolt
Flim=min(Fmember,Fglobal,Fbolt)
```

Compatibility-поле:

```text
idealizedCraneBoomPayloadKg = Flim/g0
```

остаётся численным эквивалентом чистой tip force. Оно является **reference upper bound**, а не итоговой грузоподъёмностью горизонтальной стрелы, потому что self-weight в этом case равен нулю.

## 17. Horizontal crane-boom capacity — issue #36

`crane-boom-capacity.js` решает отдельную физически более содержательную задачу.

Геометрия, stiffness/material и fixed connection остаются теми же. Вместо фактического поворота координат конструкции поворачивается gravity vector относительно frame: вес арматурных members становится распределённой поперечной нагрузкой в XY.

```text
A = pi*d²/4
qg = rho*A*g*deadLoadFactor
```

Пробный end payload:

```text
Pend = m*g*equipmentLoadFactor
```

передаётся как внутренний `topPointLoadN` на три end nodes. Wind, ice и обычная vertical equipment gravity в boom special case отключены.

Для каждого направления `0<=alpha<120°`:

```text
Utotal = max(Umember,Ubolt,1/lambda_cr)
PASS: Utotal <= 1
```

Алгоритм поиска:

```text
baseline m=0 with boom self-weight
→ exponential bracket 1,2,4,8,... kg
→ binary search
→ last passing mass
```

Результат:

```text
craneBoomCapacity.maximumEndPayloadMassKg
configuredEndPayloadMassKg
additionalEndPayloadMassKg
boomSelfWeightN
boomSelfMassEquivalentKg
governingDirectionDeg
governingMode
```

Если конструкция не проходит уже от поперечного собственного веса, mode=`boom-self-weight-overlimit` и end payload=0.

Regression требует, чтобы для типового случая `maximumEndPayloadMassKg` был меньше pure-tip `idealizedCraneBoomPayloadKg`, поскольку часть capacity уже расходует собственный вес стрелы.

Текущий boom self-weight включает арматурные frame members. Отдельная fabrication mass болтов/гаек/сварки пока не возвращается в FEM. Не моделируются lifting dynamics, rope/blocks/winch, pivot, fatigue и crane-code factors, поэтому число не является SWL.

## 18. Static top payload — issue #36

Gravity-only trial search retains mast self-weight and fixed connection but excludes wind/ice.

Единственный user vertical input — `equipmentMassKg`.

```text
maximumTopEquipmentMassKg
configuredTopEquipmentMassKg
additionalTopEquipmentMassKg
additional=max(0,maximum-configured)
```

Binary search checks member, bolt/connection и global buckling. Water-equivalent поля удалены из capacity result: `V=m/rho` является внешним преобразованием.

## 19. Maximum height

Integer module count search:

```text
exponential bracket
→ binary search
→ local neighbour scan
```

Design и ultimate-resistance limits различаются displacement criterion и требуемым `lambda_cr`. Fixed connection validity входит в candidate pass/fail.

## 20. 3D connection visualization — issue #33

`joint-visual-geometry.js` — deterministic geometry layer independent of canvas drawing. Он получает шесть local rib directions правильного октаэдра:

```text
coupling nut: 2 top-ring + 2 legs-down
clearance nut: 2 legs-up
```

Diagonal leg angle:

```text
acos(sqrt(2/3)) = 35.264... deg to bolt axis
```

Для каждого ребра хранятся nearest hex face, normal, contact point, angle to bolt axis, angle to face plane и weld display segment. `joint-viewer.js` рендерит filled depth-sorted prisms с procedural metallic hatching, contact markers и weld zones. Thread profile intentionally omitted.

## 21. User-facing complete result

`calculateCompleteMastWithConfiguredJoint()` не создаёт второй production FEM solver. Он получает canonical complete mast result, затем добавляет производственную оценку массы и `craneBoomCapacity` для той же model/fixed joint.

Snapshot schema `mast-calculator/calculation-snapshot/v9` содержит отдельные:

```text
lateralCapacity
staticPayloadCapacity
craneBoomCapacity
heightCapacity
connections
verification
```

Water-equivalent больше не является structural capacity result.

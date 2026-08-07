# Межмодульный болт и сварные концы рёбер

Статус: расчётная модель прототипа 1.0.

## 1. Назначение

Глобальная FEM мачты считает геометрические узлы идеально жёсткими. Connection layer выполняется после frame solve и отвечает на практические вопросы issue #15:

1. какое совпадающее усилие получает один реальный межмодульный болт;
2. выдерживает ли выбранный размер/класс;
3. какой минимальный стандартный диаметр нужен при разных классах прочности;
4. какая минимальная суммарная длина угловых швов нужна на каждом конце каждого ребра;
5. какой уровень электрода или проволоки совместим с основным металлом.

Connection layer не создаёт вторую FEM и не смешивает независимые максимумы разных load cases.

## 2. Физическое разделение внутреннего узла

На каждом внутреннем level геометрический FEM node содержит шесть members.

Принятая модульная сборка делит их так:

```text
нижний модуль:
  2 диагонали, приходящие снизу
  2 ребра горизонтального треугольника
  = 4 members

верхний модуль:
  2 диагонали следующей ножки
  = 2 members
```

Один вертикальный межмодульный болт соединяет двухреберную ножку верхнего модуля с четырёхреберной частью нижнего.

Для `N > 1`:

```text
Njoints = 3*(N - 1)
```

Фундаментные node сюда не входят: это отдельный тип физического соединения.

## 3. Как из FEM получается demand на болт

Для каждого внутреннего node выбираются ровно два members, идущие вверх. Их end actions одного и того же load case переводятся в global coordinates и суммируются:

```text
Fjoint = F1 + F2
Mjoint = M1 + M2
```

Это принципиальное требование. Нельзя взять maximum `N` одного направления ветра, maximum `V` другого и maximum `M` третьего и назвать это одним физическим demand.

Ось текущего stacking bolt:

```text
eb = [0, 0, 1]
```

Проекция:

```text
Faxis = Fjoint · eb
Fperp = Fjoint - eb*Faxis
```

### 3.1. Знак осевой силы

`localEndForces` solver хранит силы, действующие на отсечённую member/substructure. Для двух upward members в принятой ориентации:

```text
Faxis > 0  -> контакт стыка сжат
Faxis < 0  -> стык стремится раскрыться
```

Поэтому прямое растяжение болта:

```text
Nt,direct = max(0, -Faxis)
```

а не `abs(Faxis)`.

Это важная физическая граница: вертикальная масса, которая просто сильнее прижимает модули друг к другу, не должна превращаться в фиктивную tensile load на болт.

Для диагностики отдельно сохраняется:

```text
Ncontact = max(0, Faxis)
```

### 3.2. Передача момента

Идеальный frame node может передавать moment. Один центральный bolt сам по себе не задаёт плечо, поэтому вводится явный физический параметр:

```text
reff = jointEffectiveRadiusMm
```

Он должен соответствовать реальной контактной геометрии шайбы, гайки, торца, упора или другой детали, через которую moment замыкается.

Текущая conservative surrogate:

```text
Nt,moment = |Mb|/reff
Ns,torsion = |T|/reff

Nt = max(0, -Faxis) + |Mb|/reff
Ns = |Fperp| + |T|/reff
```

Контактное сжатие **не вычитается** из `|Mb|/reff`, пока нет модели распределения contact pressure. Это намеренно консервативно: программа не превращает compression в bolt tension, но и не кредитует неизвестную contact zone как полностью снимающую prying.

`reff` показан в UI, snapshot и paper report; это не скрытая константа.

## 4. Нормативные данные болтов

Используется СП 16.13330.2017 в применяемой редакции.

Расчётные сопротивления каталога по таблице Г.5:

| Класс | Rbun, МПа | Rbs, МПа | Rbt, МПа |
|---|---:|---:|---:|
| 5.6 | 500 | 210 | 225 |
| 5.8 | 500 | 210 | — |
| 8.8 | 830 | 332 | 451 |
| 10.9 | 1040 | 416 | 728 |
| 12.9 | 1220 | 427 | 854 |

Класс 5.8 не объявляется пригодным для demand с растяжением: таблица Г.5 не задаёт для него `Rbt`.

Площади по таблице Г.9:

| Размер | Крупный шаг, мм | Ab, мм² | Abn, мм² |
|---|---:|---:|---:|
| M16 | 2.0 | 201 | 157 |
| M20 | 2.5 | 314 | 245 |
| M24 | 3.0 | 452 | 353 |
| M30 | 3.5 | 706 | 561 |
| M36 | 4.0 | 1017 | 816 |
| M42 | 4.5 | 1385 | 1120 |
| M48 | 5.0 | 1809 | 1472 |

M18/M22/M27, помеченные в таблице Г.9 для опор ВЛ/ОРУ, не включены в общий автоматический ряд.

Для sanity-check геометрии резьбы используется:

```text
As ≈ pi/4 * (d - 0.9382*p)^2
```

но design capacity использует табличное `Abn`.

## 5. Несущая способность болта

Для одного bolt и `ns` planes:

```text
Nbs = Rbs*Ab*ns*gamma_b*gamma_c
Nbt = Rbt*Abn*gamma_c
```

В текущем single-bolt joint:

```text
gamma_b = 1.0
```

`gamma_c` остаётся явным `connectionConditionFactor`.

Совместное tension/shear:

```text
Us = Ns/Nbs
Ut = Nt/Nbt
Ubolt = sqrt(Us^2 + Ut^2)
PASS: Ubolt <= 1
```

В коде допускается только микроскопическая floating-point tolerance на границе `U=1`; она не является инженерным запасом.

## 6. «Разрывная нагрузка» и design capacity — разные вещи

Для понятной пользователю reference-величины выводится:

```text
Nu,characteristic = Rbun*Abn
```

Она называется **характеристической оценкой разрыва резьбового сечения**.

Она не является разрешённой рабочей нагрузкой и не заменяет:

```text
Nbt
Nbs
Ubolt
```

В UI/report эти величины намеренно разделены.

## 7. Подбор минимального диаметра

Для каждого класса `5.6 / 5.8 / 8.8 / 10.9 / 12.9` проверяются все physical joint demands всех operational load cases по возрастанию:

```text
M16 -> M20 -> M24 -> M30 -> M36 -> M42 -> M48
```

Первый размер, для которого **все** coincident `Nt/Ns` проходят `Ubolt<=1`, становится recommendation этого класса.

Сохраняются:

```text
boltClass
recommended diameter/pitch
governing level/node/load case
Nt, Ns
Nbt, Nbs
Ubolt
Nu,characteristic
```

## 8. Bolt check внутри lateral capacity

Unit lateral case:

```text
F0 = 1 N horizontal at top
```

Для каждого direction connection layer вычисляет:

```text
Ubolt(1 N)
Fbolt = 1/Ubolt(1 N)
```

Первый предел:

```text
Flim = min(Fmember, Fglobal, Fbolt)
```

Слабый bolt может честно стать `governingMode = bolt-connection`.

## 9. Bolt check внутри static payload

В каждом trial gravity case:

```text
U_member(m) <= 1
U_bolt(m) <= 1
lambda_cr(m) >= 1
```

При чистом симметричном vertical compression direct bolt tension должна стремиться к нулю. Bolt может получить demand из shear/moment, если они реально возникают в frame state.

Это важнее искусственного «запаса»: физическое contact compression не считается bolt tension.

## 10. Сварка каждого конца member

Для каждого physical member end сохраняется один coincident local vector:

```text
N
Vy, Vz
T
My, Mz
```

Для convenience:

```text
V = hypot(Vy,Vz)
M = hypot(My,Mz)
```

Каждый operational load case проверяется отдельно; envelope physical end выбирает case с maximum required weld length.

## 11. Сварочные сопротивления

Каталог использует уровни таблицы Г.2 СП 16:

| Материал/уровень | Rwun, МПа | Rwf, МПа |
|---|---:|---:|
| Э42А | 410 | 180 |
| Э46А | 450 | 200 |
| Э50А / УОНИ-13/55 | 490 | 215 |
| Св-08Г2С, базовый уровень Э50 | 490 | 215 |
| Э60 | 590 | 240 |
| Э70 | 685 | 280 |
| Э85 | 835 | 340 |

По fusion boundary:

```text
Rwz = 0.45*Run
```

`Run` — tensile strength более слабого parent metal.

Consumable compatibility:

```text
Rwun >= Run
```

Приложение показывает первый подходящий electrode и wire level отдельно.

## 12. Почему сварная группа пока surrogate

СП 16 для action of moment использует actual geometric properties weld group (`W`, `Ix`, `Iy`). Точные coordinates/lengths реальных трёх валиков на конкретной гайке пока не являются input.

Программа не имеет права выдумать эти `W/I`.

Поэтому moment не игнорируется, а conservative приводится через explicit weld-group radius `rw`:

```text
Qaxial = |N| + 2*|M|/rw
Qshear = |V| + |T|/rw
Qw = sqrt(Qaxial^2 + Qshear^2)
```

Сейчас `rw` задаётся calculation layer как явная derived assumption, показывается в report и должен быть заменён exact weld-group geometry, когда будут известны реальные beads.

## 13. Минимальная длина углового шва

Weld metal:

```text
lw,f = Qw/(beta_f*kf*Rwf*gamma_c)
```

Fusion boundary:

```text
lw,z = Qw/(beta_z*kf*Rwz*gamma_c)
```

Required effective total:

```text
lw = max(lw,f, lw,z, 4*kf, 40 mm)
```

СП 16 определяет effective length как сумму continuous welds за вычетом 10 мм на каждом участке. Поэтому для `nsegments`:

```text
Lphysical,total = lw + 10 mm*nsegments
Lphysical,segment = Lphysical,total/nsegments
```

`Lphysical,segment` — только технологическая подсказка при равном делении.

## 14. Что версия 1.0 намеренно не выдумывает

Без дополнительных размеров узла нельзя достоверно рассчитать:

- bearing/smearing под bolt;
- stripping external/internal thread;
- actual thread engagement length;
- prying/изгиб washer/contact plate;
- preload/friction/slip;
- fatigue;
- finite rotational/translational joint stiffness;
- exact stress distribution between actual weld beads;
- foundation bolt/base plate.

Это не незавершённая арифметика issue #15, а граница исходной geometry. Версия 1.0 закрывает поставленные задачи **самого bolt по tension/shear/combined action**, его minimum diameter by class и **minimum total fillet-weld length + consumable level**.

## 15. Regression / analytical checks

Обязательные checks:

```text
M24 8.8:
  Nbs = 332*452
  Nbt = 451*353
  Nu  = 830*353

combined:
  sqrt(0.8^2 + 0.6^2) = 1

100 kN pure tension, class 8.8:
  M16 fails
  M20 passes

compression split:
  Faxis=+10 kN -> Nt,direct=0
  Faxis=-10 kN -> Nt,direct=10 kN

weld pure axial:
  lw,f = N/(beta_f*kf*Rwf*gamma_c)
```

Также проверяются:

- M24×3 formula area близка к table `Abn=353 mm²`;
- ровно 3 internal bolt joints для 2 modules;
- ровно 2 upward members на каждый такой joint;
- 1 module не создаёт fictitious internal bolt;
- увеличение size/property class повышает bolt lateral capacity;
- достаточно слабый bolt становится actual first lateral limit;
- weld minimum `>=40 mm` и `>=4kf`;
- one governing case per physical weld end;
- UONI/E50A и Sv-08G2S recommendation для принятого `Run=490 MPa`;
- 40-module model: `117` internal joints и `2*memberCount` weld-end envelope entries.

## 16. Нормативные источники

В коде/provenance зафиксированы:

- СП 16.13330.2017 — bolted/welded steel connection design data;
- ГОСТ ISO 898-1-2014 — bolt/screw/stud property classes;
- ГОСТ 24705-2004 — metric thread dimensions;
- ГОСТ 9467-75 — covered electrodes;
- ГОСТ 34028-2016 — reinforcement steel.

Нормативные numeric values хранятся централизованно в `site/engine/connection-catalog.js`.

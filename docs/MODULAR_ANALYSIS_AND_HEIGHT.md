# Помодульный расчёт, визуализация и предельная высота

Статус: расчётная архитектура прототипа 1.1, issue #18.

## 1. Физическая ориентация одинакового модуля

Модуль всегда устанавливается **ножками вниз**.

Для модуля `i`:

```text
bottom interface: 3 нижние опорные точки
6 diagonal legs: bottom -> top
top interface: 3 узла, соединённые 3 horizontal top-ring members
```

То есть каждый physical module содержит ровно:

```text
3 top-ring members
6 leg members
= 9 members
```

Соседние треугольные уровни повёрнуты на 60°, поэтому все девять рёбер остаются равными стороне правильного октаэдра `a`.

Последний верхний треугольник не является специальной FEM-добавкой: это собственные три горизонтальных ребра последнего модуля. Параметр `closeTopRing` больше не входит в актуальную модель.

## 2. Почему нельзя просто суммировать силы сверху вниз

Если модуль был бы идеальным шарнирным стержневым объектом без изгибной жёсткости, для некоторых задач можно было бы передавать вниз только результирующие силы. Текущая модель — жёсткая пространственная Euler–Bernoulli frame-модель. Межмодульный интерфейс имеет:

```text
3 nodes * 6 DOF = 18 DOF
```

Поэтому верхний стек влияет на нижний модуль через:

- три компоненты перемещения каждого интерфейсного узла;
- три поворота;
- силы;
- моменты;
- совместную жёсткость всей верхней части.

Передача только `ΣFx,ΣFy,ΣFz` потеряла бы изгибные моменты, кручение и совместимость деформаций. Поэтому версия 1.1 использует exact linear substructuring через Schur complement.

## 3. 36-DOF matrix одного модуля

Один physical module имеет два интерфейса:

```text
bottom: 18 DOF
top:    18 DOF
```

После сборки девяти frame-elements:

```text
[ Kbb  Kbt ] [ub] = [fb]
[ Ktb  Ktt ] [ut]   [ft]
```

`Kbb/Kbt/Ktb/Ktt` имеют размер `18×18`.

У всех одинаковых модулей одинаковая локальная конструкция. Из-за поворота уровней на 60° их global matrices чередуются по ориентации, но physical topology остаётся одной и той же.

## 4. Конденсация верхнего стека сверху вниз

Пусть уже обработанная часть мачты выше текущего модуля представлена на его top interface как:

```text
Supper * ut = pupper
```

Тогда:

```text
A = Ktt + Supper
```

и верхние DOF исключаются:

```text
ut = A^-1 * (ft + pupper - Ktb*ub)
```

Эквивалентная stiffness, передаваемая на bottom interface:

```text
S = Kbb - Kbt*A^-1*Ktb
```

Эквивалентная load:

```text
p = fb - Kbt*A^-1*(ft + pupper)
```

Эта операция повторяется:

```text
top module
  -> module N-1
  -> module N-2
  -> ...
  -> bottom module
  -> rigid foundation
```

Таким образом нижний модуль получает точное линейное воздействие всех вышестоящих модулей, а не эвристическое «вес выше».

## 5. Восстановление перемещений

После top-down condensation нижний интерфейс первого модуля известен:

```text
u0 = 0
```

поскольку текущая foundation model является ideal rigid fixity.

Далее выполняется back-substitution снизу вверх:

```text
ut_i = Ai^-1 * (ft_i + pupper_i - Ktb_i*ub_i)
```

В результате получаются все `ux,uy,uz,rx,ry,rz` каждого уровня.

## 6. Cross-check с глобальной FEM

Помодульный путь не заменяет старый solver молча. Для каждого эксплуатационного load case решаются две независимые по assembly path задачи:

```text
global banded FEM
module Schur stack
```

Проверяется:

```text
||u_module - u_global|| / ||u_global|| < 1e-8
```

Также на каждом общем интерфейсе соседних модулей:

```text
Ftop,lower + Fbottom,upper = 0
Mtop,lower + Mbottom,upper = 0
```

с нормированной невязкой `< 1e-8`.

Это даёт новый internal verification layer: ошибка в top-down propagation не может незаметно изменить расчётный результат.

## 7. Global buckling остаётся глобальным

Linear eigen-buckling:

```text
(K + lambda*KG)*phi = 0
```

является свойством всей связанной конструкции. Потеря общей устойчивости может охватывать много модулей одновременно, поэтому нельзя достоверно получить `lambda_cr` последовательной проверкой каждого модуля независимо.

В версии 1.1:

```text
static response -> global + modular cross-check
global eigen-buckling -> full mast
```

Это сознательная граница декомпозиции.

## 8. Module result object

Для каждого physical module в каждом operational load case сохраняются:

```text
moduleNumber
bottomNodeIds[]
topNodeIds[]
memberIds[9]
topAppliedFromAbove[3]
bottomReactionFromBelow[3]
topResultantFromAbove
bottomResultantFromBelow
criticalMemberId
maxUtilization
maxStressUtilization
maxBucklingUtilization
maxRuptureUtilization
verticalFailureMode
verticalFailureMemberId
verticalFailureLoadFactor
```

Каждый interface action содержит:

```text
nodeId
forceN[3]
momentNm[3]
```

## 9. Детальная визуализация

Главная схема мачты поддерживает selection физического модуля:

- click по ребру;
- dropdown `Модуль`.

После selection весь модуль подсвечивается в полной мачте.

В отдельном canvas показываются:

```text
9 members selected module
node numbers
N/V/M labels on members
red arrows = action from upper stack
blue arrows = lower-stack/foundation reaction
brown arrows = direct nodal load
```

Рядом выводятся таблицы:

- все три верхних interface actions;
- все три нижних interface actions;
- все девять member results выбранного модуля.

Для верхнего модуля `topAppliedFromAbove` от несуществующего стека равен нулю; непосредственная top equipment/load при этом показывается отдельно как direct nodal load.

## 10. Группировка ведомости рёбер

Каждый member знает:

```text
moduleIndex
moduleNumber
role = top-ring | leg
```

UI позволяет:

```text
group: module | none
sort: utilization | module | member | |N| | V | M | sigma_eq | wind
order: asc | desc
```

CSV также содержит колонку `Модуль`.

## 11. Поиск максимальной высоты

Высота возможна только дискретными шагами:

```text
H(N) = N*h
```

где `N` — целое число одинаковых модулей.

Для каждого candidate `N` запускается обычный эксплуатационный расчёт с текущими:

- material/diameter;
- bolt parameters;
- wind scenario/envelope;
- ice;
- equipment;
- load factors;
- displacement/buckling limits.

### 11.1. Design height

Candidate проходит, если:

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= minimumBucklingFactor
delta_top <= displacementLimit
```

### 11.2. Ultimate-resistance height

Для отделения эксплуатационного прогиба от потери несущей способности строится второй предел:

```text
Umember <= 1
Ubolt <= 1
lambda_cr >= 1
```

Serviceability displacement здесь не ограничивает поиск.

### 11.3. Search algorithm

Полный перебор сотен высот не нужен. Используются:

```text
1. exponential bracketing: 1,2,4,8,...
2. binary search between last PASS and first FAIL
3. local neighbourhood scan around boundary
```

Локальный scan нужен потому, что пространственная ориентация модулей чередуется через 60° и дискретная последовательность может иметь небольшой parity effect.

Пользователь задаёт защитную верхнюю границу `heightSearchMaxModules`; если отказ до неё не найден, UI показывает нижнюю оценку `>= Hsearch` вместо ложного конечного максимума.

## 12. Что произойдёт с нижним модулем при вертикальной перегрузке

Issue #18 отдельно требует различать два механизма для нижнего модуля:

```text
1. local-member-buckling
2. tensile-rupture
```

Для шести leg members нижнего модуля вычисляется:

### Потеря устойчивости

Используется существующая local Euler utilization member solver:

```text
U_Euler = Ncompression / N_E
```

### Разрыв растянутой ножки

Как отдельная ultimate reference:

```text
Nrupture,design = (Rm/gamma_M)*A
Urupture = Ntension / Nrupture,design
```

Для каждого wind case берётся худшее значение; между двумя механизмами выбирается большее utilization.

Важно: `Rm/gamma_M` здесь используется именно для requested rupture discriminator. Основная member design check приложения по-прежнему использует текущую упругую yield/von-Mises модель и Euler check. Результат «разрыв или потеря устойчивости» не заменяет полный нормативный расчёт арматурного элемента.

## 13. Ограничения

Помодульная декомпозиция является **точной только в пределах текущей линейной ideal-rigid-joint FEM**.

Она не добавляет автоматически:

- P-Delta;
- initial imperfections;
- plastic hinges;
- finite bolt/contact stiffness;
- foundation compliance;
- nonlinear separation/contact;
- fatigue.

При добавлении любой из этих нелинейностей Schur workflow должен быть пересмотрен как incremental/nonlinear substructuring, а не механически использован без изменения.

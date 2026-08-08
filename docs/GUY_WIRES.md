# Дополнительные растяжки мачты

## Назначение

Растяжки являются опциональной частью того же переносимого `mast-calculator/project/v1`, а не отдельным приложением. Основной Web project editor позволяет включить растяжки, задать число ярусов, высоту крепления, 3–6 растяжек на ярус, расстояние до анкеров, поворот по азимуту, тип/диаметр троса, преднатяг, коэффициент запаса и эффективность заделки.

Один Calculate job возвращает два разных результата:

```text
CalculationResult    — полный обычный расчёт мачты, соединений, пределов и отчётов
GuyedResult          — дополнительная нелинейная tension-only cable envelope
```

Эти контракты намеренно не смешиваются. В частности, существующие bare-frame `staticPayloadCapacity`, `lateralCapacity`, `craneBoomCapacity` и `heightCapacity` не переименовываются в «пределы мачты с растяжками»: для этого понадобились бы отдельные guyed capacity searches.

Старый URL `guys.html` сохранён только как compatibility deep-link и перенаправляет в основной workspace `index.html#guys`; второй mast form и второй calculation orchestration удалены.

## Project package

Пользовательская конфигурация хранится в optional `ProjectPackage.guys`:

```text
tiers[]:
  id
  heightM
  guyCount
  anchorRadiusM
  pretensionN
  azimuthOffsetDeg
  wireId
safetyFactor
terminationEfficiency
```

В package не записываются derived length/angle/tension/reaction/envelope values. Open/Save работает через тот же редактор, из которого запускается расчёт.

## Привязка к узлам

Сосредоточенная сила прикладывается к реальному интерфейсному узлу модуля. Введённая высота округляется до ближайшего уровня:

```text
level = round(Hrequested / hmodule)
Hactual = level * hmodule
```

3–6 растяжек распределяются между тремя физическими узлами максимально равномерно. Циклический сдвиг выбирается по минимальной суммарной угловой разнице между узлами и анкерами, поэтому повёрнутый уровень не превращает симметричные три растяжки в случайную схему `2+1+0`.

## Геометрия и трос

Для узла `x` и анкера `a`:

```text
r = a - x
L = |r|
q = r/L
alpha = atan2(|dz|, sqrt(dx^2 + dy^2))
```

Расстояние до анкера в UI — горизонтальный радиус от оси мачты.

### Оцинкованный 6×19 со стальным сердечником

Для класса 6×19 используются коэффициенты EN 12385-4:

```text
Ametal = C2*d^2,    C2 = 0.449
m100   = W2*d^2,    W2 = 0.400 kg/100m
Fmin   = K2*d^2*Rr, K2 = 0.356
Rr     = 1770 MPa
```

Диаметры: 4, 5, 6, 8, 10, 12, 14, 16 мм. `Eeff=82 GPa` — параметр модели свитого каната, который следует заменять паспортным значением конкретного изделия при его наличии.

### Нержавеющий AISI 316 7×19

Диаметры 3, 4, 5, 6, 7, 8, 10, 12 мм имеют табличные значения массы и минимальной разрывной нагрузки для класса 1570 MPa. `Eeff=80 GPa` и эквивалентная металлическая площадь используются как предварительные параметры жёсткости; сертификат поставщика имеет приоритет.

## Рабочая нагрузка

```text
Fterminated = Fmin * eta_terminal
Fworking    = Fterminated / gamma_guy
```

По умолчанию `eta_terminal=0.80`, `gamma_guy=3.0`. Эти коэффициенты не заменяют проверку талрепа, коуша, зажимов, опрессовки и анкера.

## Tension-only модель

Растяжка не воспринимает сжатие:

```text
kax = Eeff*Ametal/L0
Traw = T0 + kax*(L - L0)
T = max(0, Traw)
```

При `Traw<=0` кабель выключается из касательной жёсткости до повторного натяжения.

Для активного прямого кабеля:

```text
Kt = kax*(q*q^T) + (T/L)*(I - q*q^T)
```

Первое слагаемое — осевая материальная жёсткость, второе — геометрическая поперечная жёсткость от существующего натяжения.

## Newton-итерация

Сила на узел `f(u)=T(u)*q(u)`. В точке `u0`:

```text
f(u) ~= f(u0) - Kt*(u-u0)
(Kmast + Kt) * u = Fexternal + f(u0) + Kt*u0
```

После шага пересчитываются длина, направление, натяжение и active-state. Defaults:

```text
max iterations = 25
absolute displacement change <= 1e-8 m
relative tension change <= 1e-6
```

Несходимость делает guyed расчёт непроходным.

## Реакции

```text
forceOnMastN
moduleNodeReactionN = -forceOnMastN
anchorLoadN         = -forceOnMastN
```

Кабель считается шарнирно закреплённым и локальный момент не передаёт. Грунтовый анкер и локальная деталь крепления должны проверяться отдельно.

## Ветровая огибающая

Сокращение по 120° допустимо для симметрии голой трёхгранной мачты, но произвольные 4/5 растяжек эту симметрию нарушают. Поэтому `guyWindDirections()` при включённой огибающей перебирает полный круг `0<=angle<360`. При шаге 30° выполняются 12 нелинейных расчётных случаев.

## Критерии прохождения

```text
Umember <= 1
Uwire   <= 1
delta_top <= delta_limit
lambda_cr >= lambda_required
Newton converged for every wind case
```

Основной workspace показывает отдельный guyed summary: общий PASS/FAIL, `Umember`, `Uwire`, прогиб, `lambda_cr`, cable envelope и предупреждения. Для сравнения также сохраняется обычный bare `CalculationResult` тех же исходных данных.

## Web/application architecture

```text
canonical project form
      + optional ProjectGuysInput
                ↓
      calculation-controller
                ↓ one Worker job
      calculateProjectWithGuys()
           ┌────┴────────┐
           ↓             ↓
 CalculationResult    GuyedResult
           ↓             ↓
 reports/limits      guy summary/envelope
 procurement ←────── guy cable materials
```

Worker не импортирует engineering/numerics/structural-analysis и не содержит второй расчёт. Application layer владеет композиционной семантикой. Web хранит оба результата отдельно.

Uniform optimize пока не является guy-aware optimizer. Если растяжки включены, попытка `optimize` завершается явной ошибкой вместо скрытого подбора голой мачты.

## Границы модели

Пока не учитываются catenary/провисание и распределённое действие собственного веса троса, ветер и лёд на самом тросе, динамика/вибрации/galloping, пластичность и усталость проволок, податливость грунта/анкера/талрепов/заделок и местная прочность детали крепления. Масса троса попадает в material/procurement output, но не превращается в распределённую FEM-нагрузку.

Отдельно от этой модели развиваются нормативная динамика ветра и монтажный tilt-up load case; их нельзя считать закрытыми наличием эксплуатационных растяжек.

## Файлы и проверки

```text
packages/domain/src/guy-wire-catalog.ts      canonical wire catalog
packages/engineering/src/guy-wire-system.ts nonlinear cable solver
packages/application/src/project-with-guys.ts adapter-neutral orchestration
apps/web/guy-editor.js                       ProjectGuysInput editor
apps/web/guy-result-panel.js                 guyed result presentation
tests/guy-wires-issue23.test.js              physics regressions
tests/headless-api-guys.test.js              application composition oracle
tests/calculation-controller-guys.test.js    Web transport contract
```

Полный `npm test`, architecture/typecheck, canonical platform gates and Web/Desktop adapter oracles remain mandatory.
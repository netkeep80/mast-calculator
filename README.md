# Калькулятор мачты

Статическое браузерное приложение для расчёта модульной мачты из сварных арматурных октаэдров. Backend не требуется: тяжёлые вычисления выполняются в Web Worker, публикация — через GitHub Pages.

Опубликованная версия: **https://netkeep80.github.io/mast-calculator/**

## Прототип 1.3 — практический сценарий, проверяемый FEM и физический узел

Пользователь начинает с одного из четырёх вопросов:

1. **Проверить конкретную мачту** — выдержит ли конструкция заданную погоду и оборудование;
2. **Подобрать конструкцию** — минимальный проходящий диаметр арматуры и согласованный соединительный узел;
3. **Узнать пределы** — максимальная высота, боковая сила, статическая масса на вершине и эквивалентный объём воды;
4. **Проверить расчёт** — алгоритм, residuals, global/Schur/dense cross-check, паспорт верификации и справочники исходных величин.

Общий UX:

```text
задача → конструкция → условия → соединение → расчёт
      → короткий ответ → доказательства → подробности / 3D / справочники
```

Подробнее: [`docs/USAGE_SCENARIOS.md`](docs/USAGE_SCENARIOS.md).

## Физический модуль

Каждый правильный октаэдр установлен **ножками вниз**:

```text
3 ребра верхнего треугольника
6 диагональных ножек
-----------------------------
9 рёбер на модуль
```

Геометрия:

```text
a = Lstock / nparts
R = a / sqrt(3)
h = a*sqrt(2/3)
H = N*h
```

Три нижних узла production-модели пока являются идеальной жёсткой заделкой по всем шести степеням свободы. Аналитические statics-tests из issue #26 используют точечные опоры без опорных моментов только как verification fixture.

## Расчётное ядро и независимые проверки

Каждый узел имеет 6 DOF `ux, uy, uz, rx, ry, rz`. Каждое ребро — пространственный Euler–Bernoulli frame element. После решения восстанавливаются `N, Vy, Vz, T, My, Mz`.

Одна и та же статическая задача проверяется тремя вычислительными путями:

1. **global FEM** — symmetric-band Cholesky;
2. **module Schur** — точная конденсация 18-DOF интерфейсов;
3. **independent dense reference FEM** — отдельная сборка элементов и Gaussian elimination.

CI сравнивает перемещения/повороты, реакции и локальные концевые усилия. Для выбранных задач независимо сравнивается и `λcr`.

## Соединительный узел

Физический межмодульный стык:

```text
2 ребра ножки → обычная проходная гайка My
                    │
                    │ болт Mx проходит свободно
                    ▼
4 ребра узла  → длинная соединительная гайка Mx
                    ▲
                    │ болт Mx ввинчивается сюда
```

Auto-конфигуратор выбирает болт, класс, обе гайки, длину болта, зацепление и базовые параметры сварки. После эксплуатационной FEM-огибающей выбранная физическая сборка фиксируется; боковая грузоподъёмность, статическая масса и поиск высоты не имеют права незаметно увеличить метиз.

### Усиленные проверки issue #33

К прежним `Rbs/Rbt`, `Ab/Abn` и силовой проверке шва добавлены независимые критерии.

**1. Нетто-сечение каждой гайки**

```text
Ahex = sqrt(3)/2*s²
Anut,net = Ahex - pi*D1²/4
Arib = pi*dbar²/4
Anut,net / Arib >= 2
```

Если длинная или проходная гайка не имеет минимум двукратного геометрического запаса относительно одного ребра, кандидат не проходит даже при достаточной прочности болта. Это дополнительный проектный критерий, не замена thread-stripping/bearing/prying checks.

**2. Преднатяг от момента затяжки**

```text
T = K*F0*d
F0,nom = T/(K*d)
F0,max = (1+Gamma)*F0,nom
Nt,strength = F0,max + Nt,external
```

По умолчанию `T=200 Н·м`, `K=0.20`, `Gamma=0.25`. Они явно видны и настраиваются. Больший момент затяжки уменьшает оставшийся растягивающий резерв болта. Пока жёсткости болта/пакета не определены, модель консервативно полностью добавляет внешнее разделяющее усилие к максимальному преднатягу и не кредитует перенос среза трением.

**3. Срез от наклонных рёбер**

```text
Faxis = F·eb
Fperp = F - eb(F·eb)
Nt,direct = max(0,-Faxis)
Ns,direct = |Fperp|
Nt,external = Nt,direct + |Mb|/reff
Ns = Ns,direct + |T|/reff
```

Поперечная составляющая наклонной силы теперь явно хранится, проверяется и выводится как прямой срез болта.

**4. Эффективная площадь шва**

```text
teff = beta_f*kf
Aeff = teff*lweff
Aeff >= kweld*Arib
2 <= kweld <= 3
kweld,default = 2.5
```

Требуемая длина шва — максимум силового расчёта, конструктивного минимума и дополнительного area-reserve. Сам коэффициент `2…3×` является консервативным требованием проекта, а не утверждением о таком нормативном коэффициенте СП/AISC. Нормативно используемый общий принцип — effective weld area = effective throat × effective length.

Подробнее: [`docs/JOINT_CONFIGURATOR.md`](docs/JOINT_CONFIGURATOR.md), [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md), [`docs/JOINT_STRENGTH_AND_VISUALIZATION.md`](docs/JOINT_STRENGTH_AND_VISUALIZATION.md).

## Улучшенная 3D-схема узла

Соединение больше не показывается условным wireframe. Вращаемая схема строит геометрию рёбер правильного октаэдра:

- четыре фактических направления рёбер у длинной гайки;
- две ножки верхнего модуля у проходной гайки;
- диагональная ножка имеет угол `acos(sqrt(2/3)) ≈ 35.264°` к оси болта;
- для каждого ребра определяется ближайшая боковая грань гайки;
- жёлтым отмечается место контакта ребра с гранью;
- красным — зона углового шва;
- гайки и болт рисуются заполненными гранями с процедурной металлической текстурой;
- резьба намеренно не визуализируется.

Это инженерная схема для аудита компоновки, не CAD-модель резьбы или фактического профиля сварного валика.

## Масса физической сборки

После расчёта отдельно показываются:

- масса одного ребра;
- масса полного межмодульного узла со сваркой;
- масса сваренного и закреплённого модуля;
- оценка всей изготовленной мачты.

Арматура: `m = ρ·πd²/4·L`. Метизы — прозрачная геометрическая оценка по справочным размерам, а не паспортная масса конкретного производителя. Масса наплавленного металла оценивается через идеализированную площадь `Aweld ≈ k²/2`.

Сборочная масса пока не добавляется автоматически обратно в self-weight FEM: требуемая длина шва получается после FEM, и прямое включение создало бы скрытый цикл `усилия → шов → масса → усилия`.

## Single-source справочники

Справочники строятся из тех же JavaScript-каталогов, которые использует solver/configurator. Схема обновлена до `mast-calculator/reference-data/v2` и включает:

- классы/диаметры арматуры, `Ry/Rm/E/ν/ρ`;
- классы болтов, `Rbun/Rbs/Rbt`, `Ab/Abn`;
- обычные и длинные гайки;
- электроды/проволоку `Rwun/Rwf`;
- проектные параметры issue #33: `T=K·F0·d`, defaults `T/K/Gamma`, минимум `Anut/Arib`, диапазон `Aeff,weld/Arib` и пояснение их статуса.

## Верификация

Паспорт верификации объединяет простые формулы геометрии/массы, равновесие сил и моментов, residual `K·u-F`, аналитические frame-задачи, global ↔ Schur, independent dense FEM, statics-oracles трёх опор и eigen-buckling residual.

Внешний КЭ-комплекс, инженерная рецензия и натурные испытания остаются **НЕ ПРОВЕРЕНО**, пока реально не выполнены.

Подробнее: [`docs/VERIFICATION_FOR_NON_SPECIALISTS.md`](docs/VERIFICATION_FOR_NON_SPECIALISTS.md), [`docs/TRIPLE_SOLVER_VERIFICATION.md`](docs/TRIPLE_SOLVER_VERIFICATION.md), [`docs/SUPPORT_REACTION_STATICS.md`](docs/SUPPORT_REACTION_STATICS.md).

## Документация

- [`docs/USAGE_SCENARIOS.md`](docs/USAGE_SCENARIOS.md) — пользовательские сценарии;
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — требования и допущения;
- [`docs/CALCULATION_ARCHITECTURE.md`](docs/CALCULATION_ARCHITECTURE.md) — архитектура расчёта;
- [`docs/MODULAR_ANALYSIS_AND_HEIGHT.md`](docs/MODULAR_ANALYSIS_AND_HEIGHT.md) — Schur и высота;
- [`docs/TRIPLE_SOLVER_VERIFICATION.md`](docs/TRIPLE_SOLVER_VERIFICATION.md) — три FEM-пути;
- [`docs/SUPPORT_REACTION_STATICS.md`](docs/SUPPORT_REACTION_STATICS.md) — аналитические реакции;
- [`docs/JOINT_CONFIGURATOR.md`](docs/JOINT_CONFIGURATOR.md) — физический конфигуратор;
- [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md) — demand/bolt/weld;
- [`docs/JOINT_STRENGTH_AND_VISUALIZATION.md`](docs/JOINT_STRENGTH_AND_VISUALIZATION.md) — issue #33;
- [`docs/REFERENCE_CATALOGS_AND_MASSES.md`](docs/REFERENCE_CATALOGS_AND_MASSES.md) — справочники и массы;
- [`docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md`](docs/LATERAL_CAPACITY_WEATHER_VALIDATION.md) — ветер/боковая сила;
- [`docs/STATIC_PAYLOAD_CAPACITY.md`](docs/STATIC_PAYLOAD_CAPACITY.md) — статическая масса;
- [`docs/PERFORMANCE_AND_PROGRESS.md`](docs/PERFORMANCE_AND_PROGRESS.md) — производительность;
- [`docs/CI_CD_REVIEW.md`](docs/CI_CD_REVIEW.md) — CI/CD.

## CI/CD

Обязательные checks включают:

```text
Syntax, policy and maintainability
Secrets scan
Triple FEM equivalence
Joint configurator
Joint strength and visualization
Support reaction statics
Usage scenarios and reference catalogs
Tests (Ubuntu / macOS / Windows)
Static site smoke test
```

Отдельный `Joint strength and visualization` запускает `npm run test:joint-strength` и проверяет net-section обеих гаек, area-reserve шва, torque-preload, срез от наклонной силы и геометрию 4+2 рёбер 3D-схемы.

Локально:

```bash
npm test
npm run test:triple
npm run test:joint
npm run test:joint-strength
npm run test:statics
npm run test:ux
npm run check
node scripts/check-file-line-limits.mjs
```

Runtime npm dependencies отсутствуют.

## Что пока не доказано

Совпадение внутренних решателей и regression-suite не превращает прототип в нормативный сертификат. Открыты P-Delta/геометрическая нелинейность, initial imperfections, пластичность, конечная податливость узла, thread stripping по фактическому материалу гайки, реальные допуски/покрытия/смазка, bearing/prying, распределение внешней силы по жёсткостям болта и пакета, friction-grip/slip, точная геометрия сварных валиков, остаточные напряжения, усталость/самоотвинчивание, параметрический фундамент, полный набор нормативных сочетаний и независимая проверка реальной мачты сторонним FEM/испытанием.

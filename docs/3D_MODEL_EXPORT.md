# Экспорт подробной 3D-модели мачты

Wavefront OBJ экспортирует рассчитанную мачту как polygon mesh. После issues #45 и #47 экранная подробная 3D-модель, отдельный design workspace и OBJ используют **один и тот же генератор геометрии**:

```text
packages/design/src/detailed-mast-model.js
mast-calculator/detailed-mast-model/v1
```

## Где теперь находится экспорт

После issue #47 OBJ относится не к расчётному отчёту, а к представлению принятой конструкции.

Порядок работы:

1. выполнить расчёт или автоподбор в основном калькуляторе;
2. нажать **«Открыть 3D и КД»**;
3. в `design.html` проверить подробную модель;
4. нажать **«Скачать OBJ»**.

В том же design workspace можно скачать переносимый JSON package конструкции и отдельную КД по ЕСКД. Прямой OBJ-export больше не является обязанностью calculation bootstrap.

Если конструкция ранее сохранена как `mast-calculator/design-package/v1`, её можно открыть непосредственно в design workspace без повторного FEM.

## Общий источник геометрии

```js
import { buildDetailedMastModel } from './engine/detailed-mast-model.js'

const mesh = buildDetailedMastModel(calculationResult)
```

Результат содержит:

```text
units: mm
objects[]
  name
  group
  kind
  memberId / moduleIndex / moduleIndices
  vertices[][]
  faces[][]
bounds
statistics
```

Эту структуру используют:

```text
MastViewer
apps/web/design.html
createMastObj()
technical-projection.js -> виды КД
```

Это важный regression contract: нельзя создавать отдельную «OBJ-геометрию» или отдельную «геометрию чертежа» мачты.

## Арматура

Каждое frame-member превращается из FEM-centerline в замкнутый многогранный цилиндр:

- координаты берутся из `model.nodes`;
- диаметр берётся из **конкретного `member.diameterM`**;
- mixed-diameter profile поэтому переносится без потери информации;
- каждый member имеет собственный объект и ownership модуля;
- по умолчанию OBJ использует 12 радиальных сегментов.

## Соединительный крепёж

Если расчёт содержит выбранную `connections.configurator.geometry`, detailed model добавляет на физических уровнях:

- длинные соединительные гайки;
- проходные гайки;
- отверстия гаек;
- стержни болтов;
- шестигранные головки.

Размеры приходят из production-каталогов соединения. Экспортер не содержит отдельного списка метизов.

## Единицы и координаты

OBJ записывается в миллиметрах, `Z` направлена вверх по мачте. Сам формат Wavefront OBJ не имеет стандартного поля единиц, поэтому в CAD/mesh-программе следует интерпретировать:

```text
1 OBJ unit = 1 mm
```

## Намеренные ограничения

Это подробная инженерная mesh-модель, но пока не производственная solid-CAD модель.

Не моделируются:

- винтовой профиль резьбы;
- точный профиль сварного валика;
- фаски и радиусы конкретного производителя;
- технологические допуски;
- фасонная подрезка арматуры по поверхности гайки;
- контактные/boolean операции между всеми телами.

Рёбра и hardware могут локально геометрически пересекаться: расчётная модель содержит centerlines и основные размеры, но не должна выдумывать неизвестную технологическую форму разделки.

## API

```js
import { createMastObj } from './engine/obj-export.js'

const objText = createMastObj(result, {
  radialSegments: 12,
  includeJointHardware: true,
  jointGapMm: 2,
})
```

`createMastObj()` является только сериализатором `buildDetailedMastModel()`.

## Проверки

```bash
npm run test:obj
npm run test:viewer
npm run test:design
```

Проверяются фактические диаметры, hardware, индексы faces, отсутствие `NaN/Infinity`, совпадение источника mesh для viewer/OBJ/КД и возможность восстановить OBJ из сохранённого design package без повторного FEM.

Подробнее об архитектурной границе: [`DESIGN_WORKSPACE.md`](DESIGN_WORKSPACE.md).

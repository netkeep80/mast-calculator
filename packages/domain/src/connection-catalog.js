import {
  METRIC_THREAD_STANDARD,
  metricThreadStressAreaMm2,
} from './metric-thread-catalog.js'

export const CONNECTION_STANDARD = 'СП 16.13330.2017 (ред. 09.12.2024)'
export const FASTENER_STANDARD = 'ГОСТ ISO 898-1-2014'
export const FASTENER_GEOMETRY_STANDARD = 'ISO 4014 / ISO 4017, справочная геометрия шестигранной головки'
export const THREAD_STANDARD = METRIC_THREAD_STANDARD
export const WELD_ELECTRODE_STANDARD = 'ГОСТ 9467-75'
export const WELD_WIRE_STANDARD = 'ГОСТ 2246-70'

// Расчетные сопротивления Rbs/Rbt и нормативное Rbun взяты из таблицы Г.5
// СП 16.13330.2017 с действующими изменениями на 09.12.2024.
// Для 5.8 таблица Г.5 не задает Rbt, поэтому класс не рекомендуется там,
// где соединение работает на растяжение.
export const BOLT_PROPERTY_CLASSES = Object.freeze({
  '5.6': Object.freeze({
    id: '5.6',
    label: '5.6',
    rbunMPa: 500,
    rbsMPa: 210,
    rbtMPa: 225,
    nutClassForTension: '5',
    standard: CONNECTION_STANDARD,
  }),
  '5.8': Object.freeze({
    id: '5.8',
    label: '5.8',
    rbunMPa: 500,
    rbsMPa: 210,
    rbtMPa: null,
    nutClassForTension: '5',
    standard: CONNECTION_STANDARD,
    note: 'В таблице Г.5 СП 16.13330.2017 отсутствует Rbt для класса 5.8.',
  }),
  '8.8': Object.freeze({
    id: '8.8',
    label: '8.8',
    rbunMPa: 830,
    rbsMPa: 332,
    rbtMPa: 451,
    nutClassForTension: '8',
    standard: CONNECTION_STANDARD,
  }),
  '10.9': Object.freeze({
    id: '10.9',
    label: '10.9',
    rbunMPa: 1040,
    rbsMPa: 416,
    rbtMPa: 728,
    nutClassForTension: '10',
    standard: CONNECTION_STANDARD,
  }),
  '12.9': Object.freeze({
    id: '12.9',
    label: '12.9',
    rbunMPa: 1220,
    rbsMPa: 427,
    rbtMPa: 854,
    nutClassForTension: '12',
    standard: CONNECTION_STANDARD,
  }),
})

export const BOLT_PROPERTY_CLASS_IDS = Object.freeze(Object.keys(BOLT_PROPERTY_CLASSES))

// Ab и Abn — таблица Г.9 СП 16.13330.2017. В issue #19 возвращены также
// размеры в скобках 18/22/27 мм: они полезны для мачтового узла и больше не
// должны исчезать из автоподбора. Их специальная область применения явно
// сохраняется в metadata, а не маскируется.
//
// headAcrossFlatsMm/headHeightMm нужны только для прозрачной оценки массы
// физической сборки и справочника. Прочностной расчёт использует Ab/Abn.
export const BOLT_SIZES = Object.freeze([
  Object.freeze({ diameterMm: 16, pitchMm: 2.0, grossAreaMm2: 201, netAreaMm2: 157, headAcrossFlatsMm: 24, headHeightMm: 10 }),
  Object.freeze({ diameterMm: 18, pitchMm: 2.5, grossAreaMm2: 254, netAreaMm2: 192, headAcrossFlatsMm: 27, headHeightMm: 11.5, scopeNote: 'Размер в скобках таблицы Г.9 СП 16; применять с проверкой области применения.' }),
  Object.freeze({ diameterMm: 20, pitchMm: 2.5, grossAreaMm2: 314, netAreaMm2: 245, headAcrossFlatsMm: 30, headHeightMm: 12.5 }),
  Object.freeze({ diameterMm: 22, pitchMm: 2.5, grossAreaMm2: 380, netAreaMm2: 303, headAcrossFlatsMm: 34, headHeightMm: 14, scopeNote: 'Размер в скобках таблицы Г.9 СП 16; применять с проверкой области применения.' }),
  Object.freeze({ diameterMm: 24, pitchMm: 3.0, grossAreaMm2: 452, netAreaMm2: 353, headAcrossFlatsMm: 36, headHeightMm: 15 }),
  Object.freeze({ diameterMm: 27, pitchMm: 3.0, grossAreaMm2: 572, netAreaMm2: 459, headAcrossFlatsMm: 41, headHeightMm: 17, scopeNote: 'Размер в скобках таблицы Г.9 СП 16; применять с проверкой области применения.' }),
  Object.freeze({ diameterMm: 30, pitchMm: 3.5, grossAreaMm2: 706, netAreaMm2: 561, headAcrossFlatsMm: 46, headHeightMm: 18.7 }),
  Object.freeze({ diameterMm: 36, pitchMm: 4.0, grossAreaMm2: 1017, netAreaMm2: 816, headAcrossFlatsMm: 55, headHeightMm: 22.5 }),
  Object.freeze({ diameterMm: 42, pitchMm: 4.5, grossAreaMm2: 1385, netAreaMm2: 1120, headAcrossFlatsMm: 65, headHeightMm: 26 }),
  Object.freeze({ diameterMm: 48, pitchMm: 5.0, grossAreaMm2: 1809, netAreaMm2: 1472, headAcrossFlatsMm: 75, headHeightMm: 30 }),
])

export const BOLT_DIAMETERS_MM = Object.freeze(BOLT_SIZES.map((item) => item.diameterMm))

// Rwun/Rwf — таблица Г.2 СП 16.13330.2017. Для Св-08Г2С выбран базовый
// уровень Э50 (Rwun=490, Rwf=215); специальный вариант Э60 имеет отдельные
// условия применения и намеренно не подменяет базовый автоматически.
export const WELD_CONSUMABLES = Object.freeze([
  Object.freeze({
    id: 'electrode-e42a',
    process: 'electrode',
    label: 'Э42А (РДС)',
    rwunMPa: 410,
    rwfMPa: 180,
    standard: WELD_ELECTRODE_STANDARD,
  }),
  Object.freeze({
    id: 'electrode-e46a',
    process: 'electrode',
    label: 'Э46А (РДС)',
    rwunMPa: 450,
    rwfMPa: 200,
    standard: WELD_ELECTRODE_STANDARD,
  }),
  Object.freeze({
    id: 'electrode-e50a-uoni-13-55',
    process: 'electrode',
    label: 'Э50А / УОНИ-13/55 (РДС)',
    rwunMPa: 490,
    rwfMPa: 215,
    standard: WELD_ELECTRODE_STANDARD,
  }),
  Object.freeze({
    id: 'wire-sv08g2s',
    process: 'wire',
    label: 'Св-08Г2С (механизированная, базовый уровень Э50)',
    rwunMPa: 490,
    rwfMPa: 215,
    standard: WELD_WIRE_STANDARD,
  }),
  Object.freeze({
    id: 'electrode-e60',
    process: 'electrode',
    label: 'Э60 (РДС)',
    rwunMPa: 590,
    rwfMPa: 240,
    standard: WELD_ELECTRODE_STANDARD,
  }),
  Object.freeze({
    id: 'electrode-e70',
    process: 'electrode',
    label: 'Э70 (РДС)',
    rwunMPa: 685,
    rwfMPa: 280,
    standard: WELD_ELECTRODE_STANDARD,
  }),
  Object.freeze({
    id: 'electrode-e85',
    process: 'electrode',
    label: 'Э85 (РДС)',
    rwunMPa: 835,
    rwfMPa: 340,
    standard: WELD_ELECTRODE_STANDARD,
  }),
])

export const WELD_CONSUMABLE_IDS = Object.freeze(WELD_CONSUMABLES.map((item) => item.id))

export { metricThreadStressAreaMm2 }

export function getBoltClass(classId) {
  const item = BOLT_PROPERTY_CLASSES[classId]
  if (!item) throw new Error(`Неизвестный класс прочности болта: ${classId}`)
  return item
}

export function getBoltSize(diameterMm) {
  const value = Number(diameterMm)
  const item = BOLT_SIZES.find((candidate) => candidate.diameterMm === value)
  if (!item) throw new Error(`Диаметр M${diameterMm} отсутствует в расчетном ряду СП 16, таблица Г.9`)
  return item
}

export function getWeldConsumable(consumableId) {
  const item = WELD_CONSUMABLES.find((candidate) => candidate.id === consumableId)
  if (!item) throw new Error(`Неизвестный сварочный материал: ${consumableId}`)
  return item
}

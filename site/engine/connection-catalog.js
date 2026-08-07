export const CONNECTION_STANDARD = 'СП 16.13330.2017 (ред. 09.12.2024)'
export const FASTENER_STANDARD = 'ГОСТ ISO 898-1-2014'
export const THREAD_STANDARD = 'ГОСТ 24705-2004 / ISO metric coarse thread'
export const WELD_ELECTRODE_STANDARD = 'ГОСТ 9467-75'

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
  }),
  '5.8': Object.freeze({
    id: '5.8',
    label: '5.8',
    rbunMPa: 500,
    rbsMPa: 210,
    rbtMPa: null,
    nutClassForTension: '5',
    note: 'В таблице Г.5 СП 16.13330.2017 отсутствует Rbt для класса 5.8.',
  }),
  '8.8': Object.freeze({
    id: '8.8',
    label: '8.8',
    rbunMPa: 830,
    rbsMPa: 332,
    rbtMPa: 451,
    nutClassForTension: '8',
  }),
  '10.9': Object.freeze({
    id: '10.9',
    label: '10.9',
    rbunMPa: 1040,
    rbsMPa: 416,
    rbtMPa: 728,
    nutClassForTension: '10',
  }),
  '12.9': Object.freeze({
    id: '12.9',
    label: '12.9',
    rbunMPa: 1220,
    rbsMPa: 427,
    rbtMPa: 854,
    nutClassForTension: '12',
  }),
})

export const BOLT_PROPERTY_CLASS_IDS = Object.freeze(Object.keys(BOLT_PROPERTY_CLASSES))

// Ab и Abn — таблица Г.9 СП 16.13330.2017. Размеры в скобках этой
// таблицы (18, 22, 27 мм) предназначены для опор ВЛ и ОРУ, поэтому в
// автоматический общий подбор здесь не включены.
export const BOLT_SIZES = Object.freeze([
  Object.freeze({ diameterMm: 16, pitchMm: 2.0, grossAreaMm2: 201, netAreaMm2: 157 }),
  Object.freeze({ diameterMm: 20, pitchMm: 2.5, grossAreaMm2: 314, netAreaMm2: 245 }),
  Object.freeze({ diameterMm: 24, pitchMm: 3.0, grossAreaMm2: 452, netAreaMm2: 353 }),
  Object.freeze({ diameterMm: 30, pitchMm: 3.5, grossAreaMm2: 706, netAreaMm2: 561 }),
  Object.freeze({ diameterMm: 36, pitchMm: 4.0, grossAreaMm2: 1017, netAreaMm2: 816 }),
  Object.freeze({ diameterMm: 42, pitchMm: 4.5, grossAreaMm2: 1385, netAreaMm2: 1120 }),
  Object.freeze({ diameterMm: 48, pitchMm: 5.0, grossAreaMm2: 1809, netAreaMm2: 1472 }),
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
  }),
  Object.freeze({
    id: 'electrode-e46a',
    process: 'electrode',
    label: 'Э46А (РДС)',
    rwunMPa: 450,
    rwfMPa: 200,
  }),
  Object.freeze({
    id: 'electrode-e50a-uoni-13-55',
    process: 'electrode',
    label: 'Э50А / УОНИ-13/55 (РДС)',
    rwunMPa: 490,
    rwfMPa: 215,
  }),
  Object.freeze({
    id: 'wire-sv08g2s',
    process: 'wire',
    label: 'Св-08Г2С (механизированная, базовый уровень Э50)',
    rwunMPa: 490,
    rwfMPa: 215,
  }),
  Object.freeze({
    id: 'electrode-e60',
    process: 'electrode',
    label: 'Э60 (РДС)',
    rwunMPa: 590,
    rwfMPa: 240,
  }),
  Object.freeze({
    id: 'electrode-e70',
    process: 'electrode',
    label: 'Э70 (РДС)',
    rwunMPa: 685,
    rwfMPa: 280,
  }),
  Object.freeze({
    id: 'electrode-e85',
    process: 'electrode',
    label: 'Э85 (РДС)',
    rwunMPa: 835,
    rwfMPa: 340,
  }),
])

export const WELD_CONSUMABLE_IDS = Object.freeze(WELD_CONSUMABLES.map((item) => item.id))

export function metricThreadStressAreaMm2(diameterMm, pitchMm) {
  const diameter = Number(diameterMm)
  const pitch = Number(pitchMm)
  if (!(diameter > 0) || !(pitch > 0)) throw new Error('Диаметр и шаг резьбы должны быть положительными')
  return Math.PI / 4 * (diameter - 0.9382 * pitch) ** 2
}

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

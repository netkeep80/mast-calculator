import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REINFORCEMENT_CLASSES,
  STANDARD_DIAMETERS_MM,
} from '../site/engine/catalog.js'
import {
  BOLT_PROPERTY_CLASSES,
  BOLT_SIZES,
  WELD_CONSUMABLES,
} from '../site/engine/connection-catalog.js'
import {
  COUPLING_NUTS,
  REGULAR_NUTS,
} from '../site/engine/joint-hardware-catalog.js'
import { METRIC_COARSE_THREADS } from '../site/engine/metric-thread-catalog.js'
import {
  buildReferenceData,
  REFERENCE_DATA_SCHEMA,
} from '../site/engine/reference-data.js'

test('справочник строится из тех же каталогов, которые использует расчёт', () => {
  const data = buildReferenceData()
  assert.equal(data.schema, REFERENCE_DATA_SCHEMA)
  assert.equal(data.schema, 'mast-calculator/reference-data/v3')
  assert.equal(data.reinforcement.classes.length, Object.keys(REINFORCEMENT_CLASSES).length)
  assert.equal(data.reinforcement.diameters.length, STANDARD_DIAMETERS_MM.length)
  assert.equal(data.fasteners.classes.length, Object.keys(BOLT_PROPERTY_CLASSES).length)
  assert.equal(data.fasteners.sizes.length, BOLT_SIZES.length)
  assert.equal(data.fasteners.metricCoarseThreads.length, METRIC_COARSE_THREADS.length)
  assert.equal(data.fasteners.regularNuts.length, REGULAR_NUTS.length)
  assert.equal(data.fasteners.couplingNuts.length, COUPLING_NUTS.length)
  assert.equal(data.welding.consumables.length, WELD_CONSUMABLES.length)
})

test('ключевые расчётные значения не расходятся между справочником и каталогом', () => {
  const data = buildReferenceData()
  const a500 = data.reinforcement.classes.find((item) => item.id === 'A500C')
  assert.equal(a500.yieldStrengthMPa, REINFORCEMENT_CLASSES.A500C.yieldStrengthMPa)
  assert.equal(a500.tensileStrengthMPa, REINFORCEMENT_CLASSES.A500C.tensileStrengthMPa)

  const m24 = data.fasteners.sizes.find((item) => item.diameterMm === 24)
  const sourceM24 = BOLT_SIZES.find((item) => item.diameterMm === 24)
  assert.equal(m24.netAreaMm2, sourceM24.netAreaMm2)
  assert.equal(m24.headAcrossFlatsMm, 36)
  assert.equal(m24.headHeightMm, 15)

  const class88 = data.fasteners.classes.find((item) => item.id === '8.8')
  assert.equal(class88.rbtMPa, BOLT_PROPERTY_CLASSES['8.8'].rbtMPa)

  const uoni = data.welding.consumables.find((item) => item.id === 'electrode-e50a-uoni-13-55')
  assert.equal(uoni.rwfMPa, 215)
  assert.match(uoni.standard, /ГОСТ 9467-75/)

  const wire = data.welding.consumables.find((item) => item.id === 'wire-sv08g2s')
  assert.match(wire.standard, /ГОСТ 2246-70/)
})

test('справочник диаметров показывает вычисляемую массу погонного метра', () => {
  const data = buildReferenceData()
  const d12 = data.reinforcement.diameters.find((item) => item.diameterMm === 12)
  assert.ok(d12.massPerMeterKg > 0)
  assert.ok(Math.abs(d12.areaMm2 - Math.PI * 12 ** 2 / 4) < 1e-12)
})

test('справочник v3 публикует параметры затяжки, area-reserve и service degradation', () => {
  const data = buildReferenceData()
  assert.equal(data.jointDesign.boltPreload.relation, 'T = K*F0*d')
  assert.equal(data.jointDesign.boltPreload.defaultTighteningTorqueNm, 200)
  assert.equal(data.jointDesign.boltPreload.defaultNutFactor, 0.2)
  assert.equal(data.jointDesign.boltPreload.defaultPreloadVariation, 0.25)
  assert.equal(data.jointDesign.boltPreload.autoMaximumPreloadUtilization, 0.55)
  assert.match(data.jointDesign.boltPreload.source, /NASA-STD-5020A/)
  assert.equal(data.jointDesign.nutNetSection.minimumAreaRatioToSingleRib, 2)
  assert.match(data.jointDesign.nutNetSection.source, /дополнительный геометрический критерий/i)
  assert.equal(data.jointDesign.weldEffectiveArea.minimumAreaRatioToRib, 2)
  assert.equal(data.jointDesign.weldEffectiveArea.defaultAreaRatioToRib, 2.5)
  assert.equal(data.jointDesign.weldEffectiveArea.maximumSelectableAreaRatioToRib, 3)
  assert.match(data.jointDesign.weldEffectiveArea.source, /дополнительным критерием issue #33/i)
  assert.equal(data.jointDesign.weldServiceDegradation.defaultServiceYears, 25)
  assert.equal(data.jointDesign.weldServiceDegradation.defaultInitialStiffnessRetention, 0.97)
  assert.equal(data.jointDesign.weldServiceDegradation.defaultAnnualStiffnessLossRate, 0.0015)
  assert.equal(data.jointDesign.weldServiceDegradation.defaultMinimumStiffnessRetention, 0.85)
  assert.match(data.jointDesign.weldServiceDegradation.source, /универсального.*закона.*нет/i)
})

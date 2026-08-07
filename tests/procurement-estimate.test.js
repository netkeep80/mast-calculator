import assert from 'node:assert/strict'
import test from 'node:test'
import { getWeldConsumable } from '../packages/domain/index.js'
import { buildJointHardwareGeometry } from '../packages/domain/index.js'
import {
  buildProcurementEstimate,
  createProcurementEstimateHtml,
  PROCUREMENT_ESTIMATE_SCHEMA,
} from '../packages/design/index.js'

function estimateInput(overrides = {}) {
  return {
    moduleCount: 2,
    moduleHeightMm: 1224.744871,
    stockBarLengthMm: 6000,
    stockBarPieces: 4,
    ribCutLengthMm: 1500,
    barDiameterMm: 12,
    reinforcementLabel: 'А500С',
    densityKgM3: 7850,
    boltClass: '8.8',
    geometry: buildJointHardwareGeometry({
      boltDiameterMm: 24,
      boltClass: '8.8',
      threadEngagementFactor: 2,
    }),
    weldConsumable: getWeldConsumable('electrode-e50a-uoni-13-55'),
    weldLegMm: 4,
    weldPhysicalLengthPerEndMm: 60,
    reservePercent: 10,
    guyCableDiameterMm: 6,
    guyCableLengthM: 30,
    ...overrides,
  }
}

test('закупочная смета считает раскрой, метизы, сварку и ручной трос', () => {
  const estimate = buildProcurementEstimate(estimateInput())
  assert.equal(estimate.schema, PROCUREMENT_ESTIMATE_SCHEMA)
  assert.equal(estimate.geometry.ribCount, 18)
  assert.equal(estimate.geometry.mixedDiameters, false)
  assert.equal(estimate.rebar.groups.length, 1)
  assert.equal(estimate.rebar.purchaseRibCount, 20)
  assert.equal(estimate.rebar.stockBarCount, 5)
  assert.equal(estimate.rebar.spareCutPieceCount, 2)
  assert.equal(estimate.hardware.designCountEach, 6)
  assert.equal(estimate.hardware.purchaseCountEach, 7)
  assert.equal(estimate.welding.weldEndCount, 36)
  assert.equal(estimate.guyCable.imported, false)
  assert.equal(estimate.guyCable.designLengthM, 30)
  assert.equal(estimate.guyCable.procurementLengthM, 33)
  assert.equal(estimate.items.find((item) => item.id === 'guy-cable').procurementQuantity, 33)
})

test('разные диаметры по ярусам закупаются отдельными позициями', () => {
  const estimate = buildProcurementEstimate(estimateInput({
    moduleCount: 3,
    moduleDiametersMm: [20, 16, 12],
    reservePercent: 0,
    guyCableLengthM: 0,
    guyCableDiameterMm: 0,
  }))
  assert.equal(estimate.geometry.mixedDiameters, true)
  assert.deepEqual(estimate.geometry.moduleDiametersMm, [20, 16, 12])
  assert.equal(estimate.rebar.groups.length, 3)
  assert.equal(estimate.rebar.stockBarCount, 9)
  for (const diameter of [20, 16, 12]) {
    const group = estimate.rebar.groups.find((item) => item.diameterMm === diameter)
    assert.equal(group.designRibCount, 9)
    assert.equal(group.stockBarCount, 3)
    assert.equal(estimate.items.find((item) => item.id === `rebar-${diameter}`).procurementQuantity, 3)
  }
})

test('результат расчёта растяжек переносится отдельными типами троса', () => {
  const estimate = buildProcurementEstimate(estimateInput({
    reservePercent: 5,
    guyCableGroups: [
      {
        wireId: 'galv-6x19-iwrc-6',
        label: 'Оцинкованный 6×19, стальной сердечник, Ø6 мм',
        diameterMm: 6,
        massKgM: 0.144,
        designLengthM: 30,
        source: 'guy-calculator',
      },
      {
        wireId: 'galv-6x19-iwrc-8',
        label: 'Оцинкованный 6×19, стальной сердечник, Ø8 мм',
        diameterMm: 8,
        massKgM: 0.256,
        designLengthM: 20,
        source: 'guy-calculator',
      },
    ],
  }))
  assert.equal(estimate.guyCable.imported, true)
  assert.equal(estimate.guyCable.groups.length, 2)
  assert.equal(estimate.guyCable.designLengthM, 50)
  assert.equal(estimate.guyCable.procurementLengthM, 52.5)
  const rows = estimate.items.filter((item) => item.category === 'Стальной трос / оттяжки')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].procurementQuantity, 31.5)
  assert.equal(rows[1].procurementQuantity, 21)
  assert.match(rows[0].note, /автоматически/i)
})

test('при механизированной сварке закупочной позицией становится проволока', () => {
  const estimate = buildProcurementEstimate(estimateInput({
    weldConsumable: getWeldConsumable('wire-sv08g2s'),
    reservePercent: 0,
    guyCableLengthM: 0,
    guyCableDiameterMm: 0,
  }))
  const selected = estimate.items.find((item) => item.id === 'selected-welding-consumable')
  const alternate = estimate.items.find((item) => item.id === 'alternate-welding-consumable')
  assert.equal(selected.category, 'Сварочная проволока')
  assert.equal(alternate.category, 'Электроды')
  assert.equal(alternate.procurementQuantity, 0)
})

test('печатная смета содержит материалы, цены, оттяжки, итог и browser print', () => {
  const estimate = buildProcurementEstimate(estimateInput({
    moduleCount: 3,
    moduleDiametersMm: [20, 16, 12],
    guyCableGroups: [{
      wireId: 'galv-6x19-iwrc-6',
      label: 'Оцинкованный 6×19, стальной сердечник, Ø6 мм',
      diameterMm: 6,
      designLengthM: 30,
      source: 'guy-calculator',
    }],
  }))
  const html = createProcurementEstimateHtml(estimate, '07.08.2026, 22:05:00')
  assert.match(html, /Закупочная смета мачты/)
  assert.match(html, /Ø20/)
  assert.match(html, /Ø16/)
  assert.match(html, /Ø12/)
  assert.match(html, /Стальной трос \/ оттяжки/)
  assert.match(html, /Оцинкованный 6×19/)
  assert.match(html, /расчёт страницы «Растяжки»/)
  assert.match(html, /Цена за ед\./)
  assert.match(html, /Итого по введённым ценам/)
  assert.match(html, /window\.print\(\)/)
  assert.match(html, /@media print/)
})

test('смета отклоняет нецелое число частей прутка', () => {
  assert.throws(
    () => buildProcurementEstimate(estimateInput({ stockBarPieces: 3.5 })),
    /должно быть целым числом/,
  )
})

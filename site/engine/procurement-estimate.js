import {
  estimateFilletWeldMassKg,
  reinforcementMassPerMeterKg,
} from './assembly-mass.js'
import { resolveModuleDiameters } from './diameter-profile.js'
import { HARDWARE_STEEL_DENSITY_KG_M3 } from './joint-hardware-catalog.js'

export const PROCUREMENT_ESTIMATE_SCHEMA = 'mast-calculator/procurement-estimate/v3'
export const PROCUREMENT_GUY_STORAGE_KEY = 'mast-calculator/guy-procurement/v1'
export const PROCUREMENT_RIBS_PER_MODULE = 9
export const PROCUREMENT_JOINTS_PER_MODULE = 3
export const PROCUREMENT_RIB_ENDS_PER_MODULE = PROCUREMENT_RIBS_PER_MODULE * 2

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const positive = (value, name) => {
  const number = Number(value)
  if (!(number > 0)) throw new Error(`${name} должно быть положительным`)
  return number
}
const positiveInteger = (value, name) => {
  const number = positive(value, name)
  if (!Number.isInteger(number)) throw new Error(`${name} должно быть целым числом`)
  return number
}
const nonNegative = (value, name) => {
  const number = Number(value)
  if (!(number >= 0)) throw new Error(`${name} не должно быть отрицательным`)
  return number
}
const ceilWithReserve = (quantity, reserveFactor) => Math.ceil(quantity * reserveFactor - 1e-12)

function hardwareDescription(geometry, boltClass) {
  const bolt = geometry.bolt
  const clearance = geometry.bottomClearanceNut
  const coupling = geometry.topCouplingNut
  return {
    bolt: `M${bolt.diameterMm}×${bolt.lengthMm} мм, класс ${boltClass}`,
    clearanceNut: `M${clearance.threadDiameterMm}, s=${clearance.acrossFlatsMm} мм, h=${clearance.heightMm} мм`,
    couplingNut: `M${coupling.threadDiameterMm}, s=${coupling.acrossFlatsMm} мм, L=${coupling.lengthMm} мм`,
  }
}

function compactModuleNumbers(moduleNumbers) {
  const ranges = []
  let start = null
  let previous = null
  for (const number of moduleNumbers) {
    if (start == null) {
      start = number
      previous = number
    } else if (number === previous + 1) {
      previous = number
    } else {
      ranges.push(start === previous ? String(start) : `${start}–${previous}`)
      start = number
      previous = number
    }
  }
  if (start != null) ranges.push(start === previous ? String(start) : `${start}–${previous}`)
  return ranges.join(', ')
}

function buildRebarGroups({
  moduleCount,
  barDiameterMm,
  moduleDiametersMm,
  stockBarLengthMm,
  stockBarPieces,
  ribCutLengthMm,
  densityKgM3,
  reserveFactor,
}) {
  const diameters = resolveModuleDiameters({ moduleCount, barDiameterMm, moduleDiametersMm })
  const grouped = new Map()
  diameters.forEach((diameterMm, index) => {
    const key = Number(diameterMm)
    if (!grouped.has(key)) grouped.set(key, { diameterMm: key, moduleNumbers: [] })
    grouped.get(key).moduleNumbers.push(index + 1)
  })

  const groups = [...grouped.values()].map((group) => {
    const designRibCount = group.moduleNumbers.length * PROCUREMENT_RIBS_PER_MODULE
    const purchaseRibCount = ceilWithReserve(designRibCount, reserveFactor)
    const stockBarCount = Math.ceil(purchaseRibCount / stockBarPieces)
    const availableCutPieceCount = stockBarCount * stockBarPieces
    const purchasedLengthM = stockBarCount * stockBarLengthMm / 1000
    const usefulRibLengthM = designRibCount * ribCutLengthMm / 1000
    const massPerMeterKg = reinforcementMassPerMeterKg(group.diameterMm, densityKgM3)
    return {
      diameterMm: group.diameterMm,
      moduleNumbers: group.moduleNumbers,
      moduleRangeLabel: compactModuleNumbers(group.moduleNumbers),
      designRibCount,
      purchaseRibCount,
      stockBarCount,
      availableCutPieceCount,
      spareCutPieceCount: availableCutPieceCount - designRibCount,
      usefulRibLengthM,
      purchasedLengthM,
      massPerMeterKg,
      purchasedMassKg: purchasedLengthM * massPerMeterKg,
    }
  })
  return { diameters, groups }
}

function buildGuyCableGroups(input, reserveFactor) {
  const imported = Array.isArray(input.guyCableGroups) && input.guyCableGroups.length > 0
  const source = imported
    ? input.guyCableGroups
    : [{
        id: 'manual',
        wireId: null,
        label: null,
        diameterMm: input.guyCableDiameterMm ?? 0,
        designLengthM: input.guyCableLengthM ?? 0,
        source: 'manual',
      }]

  return source.map((group, index) => {
    const designLengthM = nonNegative(group.designLengthM ?? 0, `Длина троса ${index + 1}`)
    const diameterMm = nonNegative(group.diameterMm ?? 0, `Диаметр троса ${index + 1}`)
    return {
      id: group.id ?? group.wireId ?? `guy-${index + 1}`,
      wireId: group.wireId ?? null,
      label: group.label ?? null,
      diameterMm,
      designLengthM,
      procurementLengthM: designLengthM * reserveFactor,
      massKgM: nonNegative(group.massKgM ?? 0, `Масса троса ${index + 1}`),
      source: group.source ?? (imported ? 'guy-calculator' : 'manual'),
    }
  })
}

export function buildProcurementEstimate(input) {
  const moduleCount = positiveInteger(input.moduleCount, 'Число модулей')
  const stockBarLengthMm = positive(input.stockBarLengthMm, 'Закупочная длина прутка')
  const stockBarPieces = positiveInteger(input.stockBarPieces, 'Число частей из прутка')
  const ribCutLengthMm = positive(input.ribCutLengthMm, 'Длина ребра')
  const barDiameterMm = positive(input.barDiameterMm, 'Диаметр арматуры')
  const densityKgM3 = positive(input.densityKgM3 ?? HARDWARE_STEEL_DENSITY_KG_M3, 'Плотность материала')
  const reservePercent = nonNegative(input.reservePercent ?? 0, 'Запас')
  const reserveFactor = 1 + reservePercent / 100
  const geometry = input.geometry
  if (!geometry?.bolt || !geometry?.bottomClearanceNut || !geometry?.topCouplingNut) {
    throw new Error('Для закупочной сметы нужна рассчитанная геометрия соединительного узла')
  }
  const weldConsumable = input.weldConsumable
  if (!weldConsumable?.label || !weldConsumable?.process) {
    throw new Error('Для закупочной сметы нужен выбранный сварочный материал')
  }
  const weldLegMm = positive(input.weldLegMm, 'Катет шва')
  const weldPhysicalLengthPerEndMm = nonNegative(input.weldPhysicalLengthPerEndMm, 'Физическая длина шва на конец')

  const rebarProfile = buildRebarGroups({
    moduleCount,
    barDiameterMm,
    moduleDiametersMm: input.moduleDiametersMm,
    stockBarLengthMm,
    stockBarPieces,
    ribCutLengthMm,
    densityKgM3,
    reserveFactor,
  })
  const rebarGroups = rebarProfile.groups
  const designRibCount = moduleCount * PROCUREMENT_RIBS_PER_MODULE
  const purchaseRibCount = rebarGroups.reduce((sum, group) => sum + group.purchaseRibCount, 0)
  const stockBarCount = rebarGroups.reduce((sum, group) => sum + group.stockBarCount, 0)
  const availableCutPieceCount = rebarGroups.reduce((sum, group) => sum + group.availableCutPieceCount, 0)
  const usefulRibLengthM = rebarGroups.reduce((sum, group) => sum + group.usefulRibLengthM, 0)
  const purchasedRebarLengthM = rebarGroups.reduce((sum, group) => sum + group.purchasedLengthM, 0)
  const purchasedRebarMassKg = rebarGroups.reduce((sum, group) => sum + group.purchasedMassKg, 0)

  const designHardwareCount = moduleCount * PROCUREMENT_JOINTS_PER_MODULE
  const purchaseHardwareCount = ceilWithReserve(designHardwareCount, reserveFactor)
  const descriptions = hardwareDescription(geometry, input.boltClass ?? '—')

  const weldEndCount = moduleCount * PROCUREMENT_RIB_ENDS_PER_MODULE
  const weldPhysicalLengthTotalMm = weldEndCount * weldPhysicalLengthPerEndMm
  const depositedWeldMassKg = estimateFilletWeldMassKg({
    weldLegMm,
    physicalLengthMm: weldPhysicalLengthTotalMm,
    densityKgM3,
  }).massKg
  const weldingPurchaseMassKg = depositedWeldMassKg * reserveFactor
  const guyCableGroups = buildGuyCableGroups(input, reserveFactor)

  const selectedWeldingCategory = weldConsumable.process === 'wire' ? 'Сварочная проволока' : 'Электроды'
  const alternateWeldingCategory = weldConsumable.process === 'wire' ? 'Электроды' : 'Сварочная проволока'

  const rebarItems = rebarGroups.map((group) => ({
    id: rebarGroups.length === 1 ? 'rebar' : `rebar-${group.diameterMm}`,
    category: 'Арматура',
    specification: `${input.reinforcementLabel ?? 'арматура'} Ø${group.diameterMm}; пруток ${stockBarLengthMm / 1000} м → ${stockBarPieces}×${ribCutLengthMm} мм`,
    unit: 'пруток',
    designQuantity: group.designRibCount,
    procurementQuantity: group.stockBarCount,
    note: `Модули ${group.moduleRangeLabel}: ${group.designRibCount} рёбер; доступно ${group.availableCutPieceCount} заготовок, запас ${group.spareCutPieceCount} шт.; масса закупленной арматуры ≈ ${group.purchasedMassKg.toFixed(2)} кг.`,
  }))

  const guyItems = guyCableGroups.map((group, index) => ({
    id: guyCableGroups.length === 1 ? 'guy-cable' : `guy-cable-${index + 1}`,
    category: 'Стальной трос / оттяжки',
    specification: group.label ?? (group.diameterMm > 0 ? `Ø${group.diameterMm} мм` : 'диаметр не задан'),
    unit: 'м',
    designQuantity: group.designLengthM,
    procurementQuantity: group.procurementLengthM,
    note: group.source === 'guy-calculator'
      ? 'Автоматически перенесено из последнего совместимого расчёта страницы «Растяжки».'
      : group.designLengthM > 0
        ? 'Длина и диаметр заданы вручную в закупочной смете.'
        : 'Если используются оттяжки — выполните расчёт на странице «Растяжки» или задайте трос вручную.',
  }))

  const items = [
    ...rebarItems,
    { id: 'coupling-nut', category: 'Длинные соединительные гайки', specification: descriptions.couplingNut, unit: 'шт.', designQuantity: designHardwareCount, procurementQuantity: purchaseHardwareCount, note: 'По 3 шт. на унифицированный модуль.' },
    { id: 'clearance-nut', category: 'Проходные гайки', specification: descriptions.clearanceNut, unit: 'шт.', designQuantity: designHardwareCount, procurementQuantity: purchaseHardwareCount, note: 'По 3 шт. на унифицированный модуль.' },
    { id: 'bolt', category: 'Болты', specification: descriptions.bolt, unit: 'шт.', designQuantity: designHardwareCount, procurementQuantity: purchaseHardwareCount, note: 'По 3 шт. на унифицированный модуль.' },
    ...guyItems,
    {
      id: 'selected-welding-consumable',
      category: selectedWeldingCategory,
      specification: `${weldConsumable.label}; катет ${weldLegMm} мм`,
      unit: 'кг',
      designQuantity: depositedWeldMassKg,
      procurementQuantity: weldingPurchaseMassKg,
      note: `Расчётный наплавленный металл для ${weldEndCount} концов рёбер, Lшва=${weldPhysicalLengthPerEndMm.toFixed(1)} мм/конец. Это нижняя геометрическая оценка; технологические потери и массу огарков/разбрызгивания следует учитывать отдельно.`,
    },
    { id: 'alternate-welding-consumable', category: alternateWeldingCategory, specification: 'не выбранный процесс сварки', unit: 'кг', designQuantity: 0, procurementQuantity: 0, note: `Не требуется при выбранном материале «${weldConsumable.label}».` },
  ]

  const importedGuys = guyCableGroups.some((group) => group.source === 'guy-calculator')
  return {
    schema: PROCUREMENT_ESTIMATE_SCHEMA,
    moduleCount,
    reservePercent,
    reserveFactor,
    geometry: {
      heightM: moduleCount * finite(input.moduleHeightMm) / 1000,
      ribCount: designRibCount,
      ribCutLengthMm,
      barDiameterMm,
      moduleDiametersMm: rebarProfile.diameters,
      minimumBarDiameterMm: Math.min(...rebarProfile.diameters),
      maximumBarDiameterMm: Math.max(...rebarProfile.diameters),
      mixedDiameters: new Set(rebarProfile.diameters).size > 1,
    },
    rebar: {
      stockBarLengthMm,
      stockBarPieces,
      groups: rebarGroups,
      designRibCount,
      purchaseRibCount,
      stockBarCount,
      availableCutPieceCount,
      spareCutPieceCount: rebarGroups.reduce((sum, group) => sum + group.spareCutPieceCount, 0),
      usefulRibLengthM,
      purchasedLengthM: purchasedRebarLengthM,
      purchasedMassKg: purchasedRebarMassKg,
    },
    hardware: { designCountEach: designHardwareCount, purchaseCountEach: purchaseHardwareCount },
    welding: {
      consumable: weldConsumable,
      weldLegMm,
      weldPhysicalLengthPerEndMm,
      weldEndCount,
      weldPhysicalLengthTotalM: weldPhysicalLengthTotalMm / 1000,
      depositedMassKg: depositedWeldMassKg,
      procurementMassKg: weldingPurchaseMassKg,
    },
    guyCable: {
      groups: guyCableGroups,
      designLengthM: guyCableGroups.reduce((sum, group) => sum + group.designLengthM, 0),
      procurementLengthM: guyCableGroups.reduce((sum, group) => sum + group.procurementLengthM, 0),
      imported: importedGuys,
      manual: !importedGuys,
    },
    items,
    warnings: [
      'Смета описывает закупку материалов для принятой конструкции и не является коммерческим предложением поставщика.',
      'Для разных диаметров арматуры закупочные прутки и запас округляются отдельно по каждой позиции диаметра.',
      'Пропил при раскрое арматуры отдельно не моделируется; используйте поле запаса, если нужен технологический припуск и резерв.',
      importedGuys
        ? 'Тросы автоматически перенесены из последнего совместимого расчёта страницы «Растяжки»; перед закупкой проверьте выбранные ярусы, анкеры и типы троса.'
        : 'Тросы заданы вручную либо не заданы; для инженерного подбора используйте страницу «Растяжки».',
      'Масса сварочного материала основана на идеализированной геометрии углового шва; фактический расход зависит от технологии сварки.',
    ],
  }
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const number = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number(value))
  : '—'
function quantity(value, unit) {
  if (unit === 'шт.' || unit === 'пруток') return number(value, 0)
  if (unit === 'кг') return number(value, 3)
  return number(value, 2)
}
function estimateRows(estimate) {
  return estimate.items.map((item) => `
    <tr data-quantity="${Number(item.procurementQuantity)}">
      <td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.specification)}</td><td>${escapeHtml(item.unit)}</td>
      <td class="numeric">${quantity(item.procurementQuantity, item.unit)}</td>
      <td><input class="unit-price" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Цена: ${escapeHtml(item.category)}"></td>
      <td class="numeric row-cost">—</td><td>${escapeHtml(item.note)}</td>
    </tr>`).join('')
}
function rebarProfileLabel(estimate) {
  return estimate.rebar.groups.map((group) => `Ø${number(group.diameterMm, 0)}: ${group.stockBarCount} прутк.`).join('; ')
}
function guyProfileLabel(estimate) {
  return estimate.guyCable.groups.map((group) => `${group.label ?? `Ø${number(group.diameterMm, 0)} мм`}: ${number(group.procurementLengthM, 2)} м`).join('; ')
}

export function createProcurementEstimateHtml(estimate, createdAt = new Date().toISOString()) {
  const warningItems = estimate.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Закупочная смета мачты</title><style>
:root{font-family:Arial,sans-serif;color:#111;background:#fff}body{max-width:1200px;margin:0 auto;padding:24px;line-height:1.35}h1,h2{margin-bottom:.35rem}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 24px;margin:16px 0 24px}.meta div{border-bottom:1px solid #ccc;padding:4px 0}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #aaa;padding:7px;vertical-align:top}th{background:#f0f0f0;text-align:left}.numeric{text-align:right;white-space:nowrap}.unit-price{width:100%;min-width:90px;box-sizing:border-box;border:1px solid #aaa;padding:4px;font:inherit;text-align:right}.summary{margin:18px 0;padding:12px;border:1px solid #aaa}.actions{display:flex;gap:10px;margin:16px 0 24px}button{padding:9px 14px;font:inherit;cursor:pointer}.warnings{font-size:12px}.signature{margin-top:42px;display:grid;grid-template-columns:1fr 1fr;gap:48px}@media print{body{max-width:none;padding:0}.actions{display:none!important}.unit-price{border:0;padding:0}tr,.summary{break-inside:avoid}@page{size:A4 landscape;margin:10mm}}
</style></head><body>
<div class="actions"><button type="button" onclick="window.print()">Печать / сохранить PDF</button></div>
<h1>Закупочная смета мачты</h1><p>Ведомость материалов сформирована калькулятором мачты. Цены можно ввести прямо в таблицу перед печатью.</p>
<div class="meta"><div><strong>Модулей:</strong> ${estimate.moduleCount}</div><div><strong>Высота:</strong> ${number(estimate.geometry.heightM, 2)} м</div><div><strong>Рёбер:</strong> ${estimate.geometry.ribCount}</div><div><strong>Арматура:</strong> ${escapeHtml(rebarProfileLabel(estimate))}</div><div><strong>Запас:</strong> ${number(estimate.reservePercent, 1)}%</div><div><strong>Сформировано:</strong> ${escapeHtml(createdAt)}</div></div>
<table><thead><tr><th>Материал</th><th>Спецификация</th><th>Ед.</th><th>К закупке</th><th>Цена за ед.</th><th>Сумма</th><th>Основание / примечание</th></tr></thead><tbody>${estimateRows(estimate)}</tbody><tfoot><tr><th colspan="5">Итого по введённым ценам</th><th class="numeric" id="grand-total">0,00</th><th>Валюта цены определяется пользователем.</th></tr></tfoot></table>
<div class="summary"><strong>Раскрой арматуры:</strong> ${escapeHtml(rebarProfileLabel(estimate))}; всего ${estimate.rebar.stockBarCount} прутк. и ${number(estimate.rebar.purchasedLengthM, 2)} м закупки; проектная длина рёбер ${number(estimate.rebar.usefulRibLengthM, 2)} м; свободных заготовок ${estimate.rebar.spareCutPieceCount} шт.</div>
<div class="summary"><strong>Оттяжки:</strong> ${escapeHtml(guyProfileLabel(estimate))}; источник: ${estimate.guyCable.imported ? 'расчёт страницы «Растяжки»' : 'ручной ввод'}.</div>
<div class="summary"><strong>Сварка:</strong> ${escapeHtml(estimate.welding.consumable.label)}; ${estimate.welding.weldEndCount} концов; физическая длина швов ${number(estimate.welding.weldPhysicalLengthTotalM, 2)} м; расчётная масса наплавленного металла ${number(estimate.welding.depositedMassKg, 3)} кг.</div>
<h2>Ограничения сметы</h2><ul class="warnings">${warningItems}</ul><div class="signature"><div>Составил: ____________________</div><div>Дата: ____________________</div></div>
<script>const money=new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});function recalculate(){let total=0;document.querySelectorAll('tbody tr[data-quantity]').forEach((row)=>{const qty=Number(row.dataset.quantity||0);const price=Number(row.querySelector('.unit-price')?.value||0);const cost=qty*price;total+=cost;row.querySelector('.row-cost').textContent=price>0?money.format(cost):'—'});document.querySelector('#grand-total').textContent=money.format(total)}document.addEventListener('input',(event)=>{if(event.target.classList.contains('unit-price'))recalculate()})</script>
</body></html>`
}

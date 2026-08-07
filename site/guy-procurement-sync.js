import { getGuyWireSpec } from './engine/guy-wire-catalog.js'
import { PROCUREMENT_GUY_STORAGE_KEY } from './engine/procurement-estimate.js'

const $ = (selector) => document.querySelector(selector)

function parseNumber(text) {
  const normalized = String(text ?? '').replaceAll('\u00a0', '').replace(',', '.')
  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : Number.NaN
}

function numericValue(selector) {
  const value = Number($(selector)?.value)
  return Number.isFinite(value) ? value : null
}

function currentSignature() {
  return {
    moduleCount: numericValue('#module-count'),
    stockBarLengthMm: numericValue('#stock-length'),
    stockBarPieces: numericValue('#stock-pieces'),
    barDiameterMm: numericValue('#bar-diameter'),
    reinforcementClass: $('#reinforcement-class')?.value ?? '',
    windPressurePa: numericValue('#wind-pressure'),
    equipmentMassKg: numericValue('#equipment-mass'),
    equipmentWindAreaM2: numericValue('#equipment-area'),
    iceThicknessMm: numericValue('#ice-thickness'),
  }
}

function collectGroups() {
  const wireByTier = new Map()
  for (const tier of document.querySelectorAll('.guy-tier')) {
    const tierNumber = Number(tier.dataset.tierIndex) + 1
    const wireId = tier.querySelector('[data-field="wireId"]')?.value
    if (wireId) wireByTier.set(tierNumber, getGuyWireSpec(wireId))
  }

  const groups = new Map()
  for (const row of document.querySelectorAll('#cable-envelope-body tr')) {
    const cells = row.querySelectorAll('td')
    const tierNumber = Number(cells[0]?.textContent)
    const lengthM = parseNumber(cells[6]?.textContent)
    const wire = wireByTier.get(tierNumber)
    if (!wire || !Number.isFinite(lengthM)) continue
    if (!groups.has(wire.id)) {
      groups.set(wire.id, {
        id: wire.id,
        wireId: wire.id,
        label: wire.label,
        diameterMm: wire.diameterMm,
        massKgM: wire.massKgM,
        designLengthM: 0,
        source: 'guy-calculator',
      })
    }
    groups.get(wire.id).designLengthM += lengthM
  }
  return [...groups.values()].map((group) => ({
    ...group,
    designLengthM: Number(group.designLengthM.toFixed(3)),
  }))
}

function persistLatestCalculation() {
  const results = $('#results')
  if (!results || results.hidden) return
  const groups = collectGroups()
  if (!groups.length) return
  try {
    localStorage.setItem(PROCUREMENT_GUY_STORAGE_KEY, JSON.stringify({
      schema: PROCUREMENT_GUY_STORAGE_KEY,
      savedAt: new Date().toISOString(),
      signature: currentSignature(),
      groups,
    }))
  } catch {
    // The guy calculation remains valid even if browser storage is unavailable.
  }
}

$('#calculate-guys')?.addEventListener('click', persistLatestCalculation)

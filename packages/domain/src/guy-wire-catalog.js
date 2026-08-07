const GALVANIZED_DIAMETERS_MM = [4, 5, 6, 8, 10, 12, 14, 16]
const STAINLESS_7X19 = Object.freeze([
  { diameterMm: 3, massKgM: 0.033, minimumBreakingLoadKn: 5.00 },
  { diameterMm: 4, massKgM: 0.059, minimumBreakingLoadKn: 8.89 },
  { diameterMm: 5, massKgM: 0.093, minimumBreakingLoadKn: 13.90 },
  { diameterMm: 6, massKgM: 0.134, minimumBreakingLoadKn: 20.00 },
  { diameterMm: 7, massKgM: 0.182, minimumBreakingLoadKn: 27.30 },
  { diameterMm: 8, massKgM: 0.238, minimumBreakingLoadKn: 35.60 },
  { diameterMm: 10, massKgM: 0.372, minimumBreakingLoadKn: 55.60 },
  { diameterMm: 12, massKgM: 0.535, minimumBreakingLoadKn: 80.00 },
])

const round = (value, digits = 6) => Number(value.toFixed(digits))

function galvanized6x19SteelCore(diameterMm) {
  // EN 12385-4, class 6x19, steel core factors:
  // metallic area C2=0.449*d²; mass W2=0.400*d² kg/100 m;
  // minimum breaking-force factor K2=0.356 for rope grade 1770 MPa.
  const metallicAreaMm2 = 0.449 * diameterMm ** 2
  const massKgM = 0.400 * diameterMm ** 2 / 100
  const minimumBreakingLoadKn = 0.356 * diameterMm ** 2 * 1770 / 1000
  return {
    id: `galv-6x19-iwrc-${diameterMm}`,
    familyId: 'galv-6x19-iwrc',
    material: 'galvanized-carbon-steel',
    label: `Оцинкованный 6×19, стальной сердечник, Ø${diameterMm} мм`,
    diameterMm,
    metallicAreaMm2: round(metallicAreaMm2, 3),
    massKgM: round(massKgM, 4),
    minimumBreakingLoadKn: round(minimumBreakingLoadKn, 2),
    ropeGradeMPa: 1770,
    effectiveYoungModulusGPa: 82,
    source: 'EN 12385-4, class 6x19: C2=0.449, W2=0.400, K2=0.356; Eeff=82 GPa is a modelling default and must be replaced by supplier data when available.',
  }
}

function stainless7x19(item) {
  // Metallic area is reconstructed from Fmin/(0.90*Rm). The 0.90 factor is
  // deliberately explicit: it is only an equivalent area for axial stiffness,
  // not a claim about the actual sum of wire areas in a specific product.
  const ropeGradeMPa = 1570
  const equivalentMetallicAreaMm2 = item.minimumBreakingLoadKn * 1000 / (0.90 * ropeGradeMPa)
  return {
    id: `ss316-7x19-${item.diameterMm}`,
    familyId: 'ss316-7x19',
    material: 'stainless-steel-aisi-316',
    label: `Нержавеющий AISI 316 7×19, Ø${item.diameterMm} мм`,
    diameterMm: item.diameterMm,
    metallicAreaMm2: round(equivalentMetallicAreaMm2, 3),
    massKgM: item.massKgM,
    minimumBreakingLoadKn: item.minimumBreakingLoadKn,
    ropeGradeMPa,
    effectiveYoungModulusGPa: 80,
    source: 'Commercial 7x19 AISI 316 table, rope grade 1570 MPa; Eeff=80 GPa and equivalent metallic area are modelling defaults. Supplier certificate governs.',
  }
}

export const GUY_WIRE_CATALOG = Object.freeze([
  ...GALVANIZED_DIAMETERS_MM.map(galvanized6x19SteelCore),
  ...STAINLESS_7X19.map(stainless7x19),
])

export const DEFAULT_GUY_WIRE_ID = 'galv-6x19-iwrc-6'
export const DEFAULT_GUY_TERMINATION_EFFICIENCY = 0.8
export const DEFAULT_GUY_SAFETY_FACTOR = 3

export function getGuyWireSpec(id = DEFAULT_GUY_WIRE_ID) {
  const item = GUY_WIRE_CATALOG.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Неизвестный трос растяжки: ${id}`)
  return item
}

export function calculateGuyWireCapacity(specOrId, options = {}) {
  const spec = typeof specOrId === 'string' ? getGuyWireSpec(specOrId) : specOrId
  const terminationEfficiency = Number(options.terminationEfficiency ?? DEFAULT_GUY_TERMINATION_EFFICIENCY)
  const safetyFactor = Number(options.safetyFactor ?? DEFAULT_GUY_SAFETY_FACTOR)
  if (!(terminationEfficiency > 0 && terminationEfficiency <= 1)) {
    throw new Error('Коэффициент эффективности заделки растяжки должен быть в диапазоне (0; 1]')
  }
  if (!(safetyFactor >= 1)) throw new Error('Коэффициент запаса растяжки должен быть не меньше 1')
  const minimumBreakingLoadN = spec.minimumBreakingLoadKn * 1000
  const terminatedBreakingLoadN = minimumBreakingLoadN * terminationEfficiency
  const designWorkingLoadN = terminatedBreakingLoadN / safetyFactor
  return {
    minimumBreakingLoadN,
    terminationEfficiency,
    terminatedBreakingLoadN,
    safetyFactor,
    designWorkingLoadN,
  }
}

export function serializeGuyWireCatalog() {
  return GUY_WIRE_CATALOG.map((item) => ({
    ...item,
    capacity: calculateGuyWireCapacity(item),
  }))
}

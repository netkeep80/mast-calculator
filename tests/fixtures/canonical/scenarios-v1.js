export const CANONICAL_SCENARIO_SCHEMA = 'mast-calculator/canonical-scenarios/v1'

export const CANONICAL_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'one-module-self-weight',
    kind: 'mast',
    fullState: true,
    input: { moduleCount: 1, windPresetId: 'custom', windPressurePa: 0, windEnvelopeEnabled: false, equipmentMassKg: 0, equipmentWindAreaM2: 0, iceThicknessMm: 0 },
  }),
  Object.freeze({
    id: 'one-module-heavy-top-mass',
    kind: 'mast',
    fullState: true,
    input: { moduleCount: 1, windPresetId: 'custom', windPressurePa: 0, windEnvelopeEnabled: false, equipmentMassKg: 1000, equipmentWindAreaM2: 0, iceThicknessMm: 0 },
  }),
  Object.freeze({
    id: 'two-module-oblique-wind',
    kind: 'mast',
    fullState: true,
    input: { moduleCount: 2, windPresetId: 'custom', windPressurePa: 380, windEnvelopeEnabled: false, windDirectionDeg: 37, equipmentMassKg: 20, equipmentWindAreaM2: 0.35, iceThicknessMm: 0 },
  }),
  Object.freeze({
    id: 'four-module-wind-ice-equipment',
    kind: 'mast',
    fullState: true,
    input: { moduleCount: 4, windPresetId: 'custom', windPressurePa: 620, windEnvelopeEnabled: false, windDirectionDeg: 23, equipmentMassKg: 75, equipmentWindAreaM2: 0.8, iceThicknessMm: 8 },
  }),
  Object.freeze({
    id: 'seven-module-static-equivalence',
    kind: 'mast',
    input: { moduleCount: 7, windPresetId: 'custom', windPressurePa: 450, windEnvelopeEnabled: false, windDirectionDeg: 17, equipmentMassKg: 30, equipmentWindAreaM2: 0.5, iceThicknessMm: 2 },
  }),
  Object.freeze({
    id: 'twelve-module-physical-reference',
    kind: 'mast',
    input: { moduleCount: 12, windPresetId: 'custom', windPressurePa: 380, windEnvelopeEnabled: true, windEnvelopeStepDeg: 30, equipmentMassKg: 20, equipmentWindAreaM2: 0.35, iceThicknessMm: 0 },
  }),
  Object.freeze({
    id: 'forty-module-bounded',
    kind: 'performance-owner',
    ownerTest: 'tests/performance.test.js',
    input: { moduleCount: 40 },
  }),
  Object.freeze({
    id: 'mixed-diameters',
    kind: 'mast',
    input: { moduleCount: 3, barDiameterMm: 8, moduleDiametersMm: [16, 12, 8], windPresetId: 'custom', windPressurePa: 250, windEnvelopeEnabled: false, windDirectionDeg: 30, equipmentMassKg: 15, equipmentWindAreaM2: 0.35, iceThicknessMm: 0 },
  }),
  Object.freeze({
    id: 'manual-physical-joint',
    kind: 'mast',
    input: { moduleCount: 3, windEnvelopeEnabled: false, jointConfiguratorMode: 'manual', jointBoltDiameterMm: 24, jointBoltClass: '8.8', jointClearanceNutThreadMm: 30, jointBoltLengthMm: 80, jointThreadEngagementFactor: 2, jointTighteningTorqueNm: 200 },
  }),
  Object.freeze({
    id: 'auto-physical-joint',
    kind: 'mast',
    input: { moduleCount: 3, windEnvelopeEnabled: false, jointConfiguratorMode: 'auto', equipmentMassKg: 40, equipmentWindAreaM2: 0.6 },
  }),
  Object.freeze({
    id: 'multi-tier-guys',
    kind: 'guys',
    input: { moduleCount: 10, windPresetId: 'custom', windPressurePa: 500, windEnvelopeEnabled: false, windDirectionDeg: 11, equipmentMassKg: 25, equipmentWindAreaM2: 1.2, displacementLimitMm: 1000 },
    tiers: [
      { moduleFraction: 0.55, anchorRadiusM: 7, guyCount: 3, azimuthOffsetDeg: 0, wireId: 'galv-6x19-iwrc-6', pretensionN: 1000 },
      { moduleFraction: 1, anchorRadiusM: 9, guyCount: 3, azimuthOffsetDeg: 30, wireId: 'galv-6x19-iwrc-6', pretensionN: 1200 },
    ],
  }),
  Object.freeze({ id: 'static-top-payload', kind: 'complete-projection', projection: 'staticPayload', cacheKey: 'complete-default', input: { moduleCount: 6, heightSearchMaxModules: 12, windEnvelopeEnabled: false, lateralCapacityStepDeg: 60 } }),
  Object.freeze({ id: 'pure-lateral', kind: 'complete-projection', projection: 'lateral', cacheKey: 'complete-default', input: { moduleCount: 6, heightSearchMaxModules: 12, windEnvelopeEnabled: false, lateralCapacityStepDeg: 60 } }),
  Object.freeze({ id: 'horizontal-crane-boom', kind: 'complete-projection', projection: 'craneBoom', cacheKey: 'complete-default', input: { moduleCount: 6, heightSearchMaxModules: 12, windEnvelopeEnabled: false, lateralCapacityStepDeg: 60 } }),
  Object.freeze({ id: 'maximum-height-search', kind: 'complete-projection', projection: 'height', cacheKey: 'complete-default', input: { moduleCount: 6, heightSearchMaxModules: 12, windEnvelopeEnabled: false, lateralCapacityStepDeg: 60 } }),
  Object.freeze({ id: 'design-package-obj-round-trip', kind: 'design', cacheKey: 'complete-design', input: { moduleCount: 3, heightSearchMaxModules: 4, windEnvelopeEnabled: false, lateralCapacityStepDeg: 60 } }),
])

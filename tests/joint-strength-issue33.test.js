import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  calculateBoltCapacity,
  checkBoltDemand,
} from '../packages/engineering/index.js'
import { calculateBoltPreload } from '../packages/engineering/index.js'
import { buildJointHardwareGeometry } from '../packages/domain/index.js'
import { configureIntermoduleJoint } from '../packages/engineering/index.js'
import { splitJointDemandForBolt } from '../packages/engineering/index.js'
import {
  checkJointNutSections,
  hexAreaAcrossFlatsMm2,
} from '../packages/engineering/index.js'
import {
  buildJointVisualGeometry,
  OCTAHEDRON_LEG_ANGLE_TO_BOLT_DEG,
  representativeOctahedronJointDirections,
} from '../packages/design/index.js'
import { calculateMinimumWeldLength } from '../packages/engineering/index.js'
import { DEFAULT_PARAMETERS } from '../packages/application/index.js'

const approximately = (actual, expected, relative = 1e-10, absolute = 1e-8) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}; tolerance=${tolerance}`)
}

const geometryM24 = () => buildJointHardwareGeometry({
  boltDiameterMm: 24,
  boltClass: '8.8',
  threadEngagementFactor: 2,
})

test('issue #33: нетто-сечение обеих гаек считается как hex minus thread hole и сравнивается с ребром', () => {
  const geometry = geometryM24()
  const sections = checkJointNutSections(geometry, 12, { requiredRatio: 2 })
  const ribArea = Math.PI * 12 ** 2 / 4
  const couplingGross = hexAreaAcrossFlatsMm2(36)

  approximately(sections.ribAreaMm2, ribArea)
  approximately(sections.couplingNut.grossHexAreaMm2, couplingGross)
  assert.ok(sections.couplingNut.netAreaMm2 < couplingGross)
  assert.ok(sections.couplingNut.ratioToSingleRib >= 2)
  assert.ok(sections.clearanceNut.ratioToSingleRib >= 2)
  assert.equal(sections.passes, true)
})

test('issue #33: слишком толстое ребро блокирует выбранную гайку даже если болт сам по себе прочный', () => {
  const sections = checkJointNutSections(geometryM24(), 40, { requiredRatio: 2 })
  assert.equal(sections.passes, false)
  assert.ok(sections.couplingNut.ratioToSingleRib < 2)

  const configurator = configureIntermoduleJoint([{
    nodeId: 3,
    level: 1,
    forceGlobalN: [0, 0, -10_000],
    momentGlobalNm: [0, 0, 0],
  }], {
    ...DEFAULT_PARAMETERS,
    barDiameterMm: 40,
    jointConfiguratorMode: 'manual',
    jointBoltDiameterMm: 24,
    jointBoltClass: '12.9',
    jointClearanceNutThreadMm: 30,
    jointBoltLengthMm: 80,
    jointThreadEngagementFactor: 2,
    jointTighteningTorqueNm: 0,
    jointNutSectionAreaRatio: 2,
    weldToRibAreaRatio: 2.5,
  }, { baseMetalRunMPa: 490 })

  assert.equal(configurator.passesBolt, true)
  assert.equal(configurator.passesNutSections, false)
  assert.equal(configurator.passes, false)
})

test('issue #33: площадь эффективного горла шва имеет отдельный запас 2–3× относительно ребра', () => {
  const memberAreaMm2 = Math.PI * 12 ** 2 / 4
  const base = {
    consumableId: 'electrode-e50a-uoni-13-55',
    weldLegMm: 4,
    segmentCount: 3,
    betaF: 0.7,
    betaZ: 1,
    connectionConditionFactor: 1,
    baseMetalRunMPa: 490,
    weldGroupRadiusMm: 6,
    memberAreaMm2,
  }
  const ratio2 = calculateMinimumWeldLength({ axialForceN: 1000 }, {
    ...base,
    minimumAreaRatio: 2,
  })
  const ratio3 = calculateMinimumWeldLength({ axialForceN: 1000 }, {
    ...base,
    minimumAreaRatio: 3,
  })

  approximately(ratio2.effectiveThroatMm, 0.7 * 4)
  assert.ok(ratio2.requiredAreaRatio >= 2 - 1e-12)
  assert.ok(ratio3.requiredAreaRatio >= 3 - 1e-12)
  assert.ok(ratio3.requiredByAreaRatioMm > ratio2.requiredByAreaRatioMm)
  assert.ok(ratio3.requiredPhysicalLengthMm > ratio2.requiredPhysicalLengthMm)
})

test('issue #33: T=K*F0*d воспроизводит преднатяг и его верхнюю границу', () => {
  const preload = calculateBoltPreload({
    tighteningTorqueNm: 200,
    diameterMm: 24,
    nutFactor: 0.2,
    preloadVariation: 0.25,
  })
  approximately(preload.nominalPreloadN, 200 / (0.2 * 0.024))
  approximately(preload.maximumPreloadN, preload.nominalPreloadN * 1.25)
  approximately(preload.minimumPreloadN, preload.nominalPreloadN * 0.75)
})

test('issue #33: увеличение момента затяжки уменьшает растягивающий резерв болта', () => {
  const common = {
    diameterMm: 24,
    boltClass: '8.8',
    nutFactor: 0.2,
    preloadVariation: 0.25,
  }
  const loose = calculateBoltCapacity({ ...common, tighteningTorqueNm: 0 })
  const tightened = calculateBoltCapacity({ ...common, tighteningTorqueNm: 300 })
  const demand = { tensionN: 30_000, shearN: 20_000 }
  const looseCheck = checkBoltDemand(demand, { ...common, tighteningTorqueNm: 0 })
  const tightCheck = checkBoltDemand(demand, { ...common, tighteningTorqueNm: 300 })

  assert.ok(tightened.externalTensionReserveN < loose.externalTensionReserveN)
  assert.ok(tightCheck.preloadUtilization > 0)
  assert.ok(tightCheck.strengthTensionN > tightCheck.serviceExternalTensionN)
  assert.ok(tightCheck.utilization > looseCheck.utilization)
})

test('issue #33: при нулевом моменте затяжки старое взаимодействие tension/shear сохраняется', () => {
  const capacity = calculateBoltCapacity({ diameterMm: 24, boltClass: '8.8', tighteningTorqueNm: 0 })
  const check = checkBoltDemand({
    tensionN: capacity.tensionCapacityN * 0.6,
    shearN: capacity.shearCapacityN * 0.8,
  }, {
    diameterMm: 24,
    boltClass: '8.8',
    tighteningTorqueNm: 0,
  })
  approximately(check.interactionUtilization, 1)
  assert.equal(check.preload.maximumPreloadN, 0)
})

test('issue #33: наклонная сила явно создаёт срез болта перпендикулярно его оси', () => {
  const demand = splitJointDemandForBolt([10_000, 0, -10_000], [0, 0, 0], {
    boltAxis: [0, 0, 1],
    jointEffectiveRadiusMm: 18,
  })
  approximately(demand.directTensionN, 10_000)
  approximately(demand.directShearN, 10_000)
  approximately(demand.shearFromInclinedForceN, 10_000)
  approximately(demand.acuteAngleToBoltAxisDeg, 45)
  approximately(demand.transverseForceFraction, 1 / Math.sqrt(2))
  approximately(demand.shearN, 10_000)
})

test('issue #33: автоконфигуратор учитывает одновременно преднатяг, срез и сечение гайки', () => {
  const configurator = configureIntermoduleJoint([{
    nodeId: 3,
    level: 1,
    forceGlobalN: [35_000, 0, -70_000],
    momentGlobalNm: [100, 20, 10],
  }], {
    ...DEFAULT_PARAMETERS,
    barDiameterMm: 12,
    jointConfiguratorMode: 'auto',
    jointTighteningTorqueNm: 200,
    jointNutFactor: 0.2,
    jointPreloadVariation: 0.25,
    jointNutSectionAreaRatio: 2,
    weldToRibAreaRatio: 2.5,
  }, { baseMetalRunMPa: 490 })

  assert.equal(configurator.passes, true)
  assert.equal(configurator.passesNutSections, true)
  assert.ok(configurator.selected.evaluation.governingCheck.preload.maximumPreloadN > 0)
  assert.ok(configurator.selected.evaluation.governingDemand.directShearN > 0)
  assert.ok(configurator.selected.nutSections.minimumRatio >= 2)
})

test('issue #33: 3D-геометрия содержит 4+2 реальных ребра, контакты с гранями и зоны шва', () => {
  const directions = representativeOctahedronJointDirections()
  assert.equal(directions.length, 6)
  assert.equal(directions.filter((item) => item.group === 'coupling').length, 4)
  assert.equal(directions.filter((item) => item.group === 'clearance').length, 2)

  const visual = buildJointVisualGeometry({
    geometry: geometryM24(),
    barDiameterMm: 12,
    weldPhysicalLengthMm: 120,
  })
  assert.equal(visual.ribs.length, 6)
  assert.ok(visual.ribs.every((rib) => Number.isInteger(rib.faceIndex)))
  assert.ok(visual.ribs.every((rib) => rib.weldDisplayLengthMm > 0))
  assert.ok(visual.ribs.every((rib) => Number.isFinite(rib.angleToFacePlaneDeg)))

  const leg = visual.ribs.find((rib) => rib.role === 'leg-up')
  const ring = visual.ribs.find((rib) => rib.role === 'top-ring')
  approximately(leg.angleToBoltAxisDeg, OCTAHEDRON_LEG_ANGLE_TO_BOLT_DEG, 1e-10, 1e-10)
  approximately(ring.angleToBoltAxisDeg, 90, 1e-10, 1e-10)
})

test('issue #33: browser bootstrap содержит управление затяжкой и area-reserve, viewer — текстурированные грани', () => {
  const bootstrap = readFileSync(new URL('../apps/web/app-bootstrap.js', import.meta.url), 'utf8')
  const viewer = readFileSync(new URL('../apps/web/joint-viewer.js', import.meta.url), 'utf8')
  assert.match(bootstrap, /jointTighteningTorqueNm/)
  assert.match(bootstrap, /jointNutFactor/)
  assert.match(bootstrap, /jointNutSectionAreaRatio/)
  assert.match(bootstrap, /weldToRibAreaRatio/)
  assert.match(bootstrap, /installJointStrengthUi/)
  assert.match(viewer, /drawTexturedFace/)
  assert.match(viewer, /buildJointVisualGeometry/)
  assert.match(viewer, /красный — зона углового шва/)
})

test('issue #33: документация не выдаёт коэффициент 2.5× за нормативное требование', () => {
  const doc = readFileSync(new URL('../docs/JOINT_STRENGTH_AND_VISUALIZATION.md', import.meta.url), 'utf8')
  assert.match(doc, /дополнительный консервативный критерий проекта/)
  assert.match(doc, /не утверждение, что СП 16 или AISC требуют именно коэффициент 2\.5/)
  assert.match(doc, /NASA-STD-5020A/)
})

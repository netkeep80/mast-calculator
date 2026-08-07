# Canonical contracts

Status: current for Architecture Foundation 2.0 issue #61.

## Public project input

All environment adapters construct one grouped `ProjectInput`:

```js
{
  geometry: { moduleCount, stockBarLengthMm, stockBarPieces, barDiameterMm, moduleDiametersMm? },
  material: { reinforcementClass, materialSafetyFactor },
  environment: {
    deadLoadFactor, windLoadFactor, windPresetId, windPressurePa?, dragCoefficient,
    windDirectionDeg, windEnvelopeEnabled, windEnvelopeStepDeg, lateralCapacityStepDeg,
    iceThicknessMm, iceDensityKgM3,
  },
  equipment: { massKg, windAreaM2, dragCoefficient, loadFactor },
  connection: {
    configuratorMode, boltDiameterMm, boltClass, clearanceNutThreadMm, boltLengthMm,
    threadEngagementFactor, boltShearPlanes, conditionFactor, weldConsumableId,
    weldLegMm, weldSegmentsPerEnd, weldBetaF, weldBetaZ,
    tighteningTorqueNm?, nutFactor?, preloadVariation?, nutSectionAreaRatio?,
    weldToRibAreaRatio?, weldServiceYears?, weldInitialStiffnessRetention?,
    weldAnnualStiffnessLossRate?, weldMinimumStiffnessRetention?,
  },
  criteria: { displacementLimitMm, minimumBucklingFactor, heightSearchMaxModules },
}
```

The input does **not** contain derived or catalogue-owned values. In particular these are forbidden as user fields: `ribCutLengthMm`, `triangleSideMm`, `moduleHeightMm`, `youngModulusGPa`, `yieldStrengthMPa`, `tensileStrengthMPa`, `densityKgM3`, `windSpeedMs`, `jointEffectiveRadiusMm`, `jointBaseMetalTensileStrengthMPa`, `extraHorizontalLoadN`, and `extraVerticalLoadN`.

`createProjectInput(overrides)` is the convenience constructor. `validateProjectInput()` is the runtime boundary check for complete external values.

## Resolution

There is one public resolution step:

```text
ProjectInput
   |
   v
resolveProjectInput()
   |
   v
ResolvedProject
```

`ResolvedProject` contains the flat, fully derived values consumed by the existing numerical implementation. Adapters must never construct it directly and must never apply a second default/resolve pass.

`resolveCalculationParameters()` and `DEFAULT_PARAMETERS` remain temporary low-level fixture/migration helpers only until issue #62 converts the remaining implementation/tests. They are not public transport contracts.

## Application result

The canonical headless use case is:

```js
const result = calculateProject(projectInput)
```

The application resolves input once, performs all engineering/design enrichment through copy-on-write assembly, adds final verification, and returns one complete `CalculationResult`. The public result is deeply frozen by default. Web, CLI and Desktop adapters consume this value; they do not add engineering fields after calculation.

## External JSON

Persisted/imported project JSON is versioned independently from internal JavaScript shapes:

```json
{
  "schema": "mast-calculator/project/v1",
  "project": {
    "geometry": {},
    "material": {},
    "environment": {},
    "equipment": {},
    "connection": {},
    "criteria": {}
  }
}
```

Public helpers:

```text
createProjectPackage(ProjectInput)
serializeProjectPackage(package)
parseProjectPackage(json)
assertProjectPackage(value)
```

Unknown schema ids and unknown package/input fields fail closed with `ProjectSchemaError`. An incompatible future schema must receive a new version and explicit migration path; silently accepting unknown fields or reinterpreting them is forbidden.

## Errors

Application entrypoints normalize boundary failures to `MastApplicationError`. Categories are:

- `input-validation`
- `unsupported-configuration`
- `numerical-failure`
- `convergence-failure`
- `schema-error`
- `internal-invariant`

Adapters may translate these errors into UI/CLI messages, but must not infer engineering semantics from arbitrary exception strings.

## CI contract

The contract boundary is guarded by:

```bash
npm run typecheck
npm run test:contracts
npm run test:headless
npm run test:foundation
npm run audit:architecture
npm test
```

Canonical numerical equivalence remains a veto: contract refactoring is not allowed to alter engineering results except for explicitly reviewed serialization changes caused by removal of dead fields.

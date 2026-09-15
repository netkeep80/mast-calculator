# Portable project package

## Purpose

`mast-calculator/project/v2` is the canonical portable input format for Mast Calculator. The same package is consumed by Web, CLI and Desktop adapters.

A project package contains only user-controlled inputs, optional user-owned stage configuration and explicit metadata. Derived engineering values are resolved again when the package is opened.

`mast-calculator/project/v1` remains a supported **read-only historical input schema**. Readers migrate it explicitly to v2; writers never emit v1.

## Current v2 shape

```json
{
  "schema": "mast-calculator/project/v2",
  "metadata": {
    "name": "12 m mast",
    "description": "Example project",
    "createdAt": "2026-09-14T12:00:00.000Z"
  },
  "project": {
    "geometry": {
      "moduleCount": 12,
      "stockBarLengthMm": 12000,
      "stockBarPieces": 16,
      "barDiameterMm": 12
    },
    "material": {
      "reinforcementClass": "A400C",
      "materialSafetyFactor": 1.1
    },
    "loadActions": {
      "profile": "sp20-2016-amendment-6"
    },
    "environment": {
      "windPresetId": "custom",
      "windPressurePa": 380,
      "dragCoefficient": 1.2,
      "windDirectionDeg": 0,
      "windEnvelopeEnabled": true,
      "windEnvelopeStepDeg": 30,
      "lateralCapacityStepDeg": 15,
      "iceThicknessMm": 0,
      "iceDensityKgM3": 900
    },
    "equipment": {
      "massKg": 20,
      "windAreaM2": 0.35,
      "dragCoefficient": 1.4
    },
    "connection": {
      "configuratorMode": "auto",
      "boltDiameterMm": 24,
      "boltClass": "8.8",
      "clearanceNutThreadMm": 30,
      "boltLengthMm": 80,
      "threadEngagementFactor": 2,
      "boltShearPlanes": 1,
      "conditionFactor": 1,
      "weldConsumableId": "electrode-e50a-uoni-13-55",
      "weldLegMm": 4,
      "weldSegmentsPerEnd": 3,
      "weldBetaF": 0.7,
      "weldBetaZ": 1
    },
    "criteria": {
      "displacementLimitMm": 65,
      "minimumBucklingFactor": 2,
      "heightSearchMaxModules": 200
    }
  }
}
```

`geometry.moduleDiametersMm` is optional and stores an explicit bottom-to-top mixed-diameter profile. Connection fields remain user inputs in manual mode; in auto mode the application may select the final physical joint during calculation.

## Load-action profiles

New v2 projects use:

```json
{
  "profile": "sp20-2016-amendment-6"
}
```

The resolver owns the named design factors for this profile:

| Action | γf |
| --- | ---: |
| steel self-weight | 1.05 |
| stationary equipment weight | 1.05 |
| ice | 1.8 |
| wind | 1.4 |

The resolved result carries `loadActionProvenance`; reports and UI must distinguish this normative profile from migrated historical values.

### v1 migration

Historical v1 stored three ambiguous user coefficients:

```text
environment.deadLoadFactor
environment.windLoadFactor
equipment.loadFactor
```

Migration is deterministic and preserves historical numerical meaning:

```text
v1 environment.deadLoadFactor -> v2 steelSelfWeightLoadFactor
v1 environment.deadLoadFactor -> v2 iceLoadFactor
v1 equipment.loadFactor       -> v2 equipmentLoadFactor
v1 environment.windLoadFactor -> v2 windLoadFactor
profile                        -> manual-migrated-v1
```

The migrated v2 representation is therefore:

```json
{
  "profile": "manual-migrated-v1",
  "steelSelfWeightLoadFactor": 1.1,
  "equipmentLoadFactor": 1.1,
  "iceLoadFactor": 1.1,
  "windLoadFactor": 1.4
}
```

Finite historical zero coefficients are preserved as zero. Negative and non-finite factors are rejected at the migration boundary. A `manual-migrated-v1` project is **not relabelled as normative** and is serialized as canonical v2.

Physical modal inertia remains unfactored; load-action factors belong to design actions, not physical mass.

## Guys

Guy wires are an optional sibling of `project`, not a second project format:

```json
{
  "schema": "mast-calculator/project/v2",
  "project": { "...": "canonical ProjectInput" },
  "guys": {
    "safetyFactor": 3,
    "terminationEfficiency": 0.8,
    "tiers": [
      {
        "id": "top",
        "heightM": 8,
        "anchorRadiusM": 6,
        "guyCount": 3,
        "pretensionN": 500,
        "wireId": "galv-6x19-iwrc-6"
      }
    ]
  }
}
```

Derived cable lengths, tensions, reactions and nonlinear envelopes are results and are never persisted as project input.

## Erection

The quasi-static tilt-up stage is also an optional sibling of `project`:

```json
{
  "schema": "mast-calculator/project/v2",
  "project": { "...": "canonical ProjectInput" },
  "erection": {
    "mode": "tilt-up",
    "hingeBaseEdgeIndex": 0,
    "attachmentTopCornerIndex": 0,
    "anchorPointM": [8, -5, 1],
    "rotationSense": 1,
    "startAngleDeg": 0,
    "endAngleDeg": 90,
    "sampling": {
      "initialSegments": 6,
      "relativeTolerance": 0.02,
      "minimumAngleStepDeg": 0.25,
      "maximumEvaluations": 49,
      "maximumDepth": 12
    }
  }
}
```

Stable topology-relative selectors are persisted; generated FEM node/member IDs, cable-tension histories, sampled states, reactions, member forces and governing angles are not.

The package may explicitly contain `{ "erection": { "mode": "disabled" } }`. Absence and explicit disable remain distinct user states.

## What is deliberately not stored

The project package does **not** persist stale derived state, including:

- rib cut length or octahedron module height copies;
- catalog-resolved material strengths, density or elastic constants;
- resolved load-action or wind-action provenance copies;
- resolved joint effective radius or auto-selected hardware;
- FEM matrices, displacements, member forces or reactions;
- generated erection topology, cable tensions or sampled states;
- wind envelopes, capacities, verification passports or optimization results.

The lifecycle is:

```text
read JSON
-> parse schema
-> migrate supported historical version to current v2
-> validate canonical ProjectInput
-> resolve ProjectInput
-> resolve optional stage topology/configuration
-> calculate
```

## Versioning and migration

Readers call `migrateProjectPackage()` through the public parser/assertion boundary. Supported schemas are currently v1 and v2. v1 is migrated to v2; v2 is validated as current.

Writers always emit `mast-calculator/project/v2`.

Unknown schema ids, unknown top-level fields and unknown nested input fields fail closed with `ProjectSchemaError`. Future incompatible external JSON semantics require a new schema id plus explicit, tested migration.

## Artifact taxonomy

| Artifact | Schema / form | Purpose |
| --- | --- | --- |
| Project package | `mast-calculator/project/v2` | Recalculable user input shared by Web/CLI/Desktop |
| Historical project input | `mast-calculator/project/v1` | Read-only migration source |
| Result summary | `mast-calculator/result-summary/v1` | Stable external machine-readable result |
| Design package | versioned design package | Accepted calculated construction for downstream artifacts |
| Internal calculation snapshot | current internal snapshot schema | Reproducibility/report-generation detail |

The internal calculation snapshot is not a competing project persistence format.

## Web integration

**Скачать проект JSON** writes v2. **Открыть проект JSON** accepts supported historical versions through the same shared parser/migrator used by other adapters.

When a v1 file is opened, Web receives the canonical migrated v2 `ProjectInput`. The migrated `manual-migrated-v1` profile and its factors must survive form round-trips and subsequent Save/Calculate operations unchanged. New projects use the normative SP20 profile.

Opening a project never trusts old derived values: all derived state is resolved again from canonical user input.

# Portable project package

## Purpose

`mast-calculator/project/v1` is the canonical portable input format for Mast Calculator. The same package is consumed by the Web adapter, the CLI and future adapters such as Desktop.

The schema identifier intentionally remains `mast-calculator/project/v1`: it already existed as the canonical `ProjectInput` package before Architecture Foundation #55, so introducing a second `project-package/v1` name would create two competing formats for the same concept.

A project package contains only user-controlled inputs and explicit project metadata. Every derived engineering value is resolved again when the package is opened.

## Current shape

```json
{
  "schema": "mast-calculator/project/v1",
  "metadata": {
    "name": "12 m mast",
    "description": "Example project",
    "createdAt": "2026-08-08T12:00:00.000Z"
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
    "environment": {
      "deadLoadFactor": 1.1,
      "windLoadFactor": 1.4,
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
      "dragCoefficient": 1.4,
      "loadFactor": 1.1
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

`geometry.moduleDiametersMm` is optional and stores an explicit bottom-to-top mixed-diameter profile. Connection fields remain user inputs in manual mode; in auto mode the application is free to select the final physical joint during calculation.

## Guys

Guy wires use the same project package rather than a separate incompatible file format:

```json
{
  "schema": "mast-calculator/project/v1",
  "project": { "...": "same grouped ProjectInput as above" },
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

The package validates the guy configuration before calculation. The engineering layer still resolves catalog data and physical attachment geometry at runtime.

## What is deliberately not stored

The input package must not contain stale derived state. In particular it does **not** persist:

- calculated rib cut length or octahedron module height copies;
- catalog-resolved material strengths, density or elastic constants;
- resolved joint effective radius or automatically selected physical hardware;
- FEM matrices, displacements, member forces or reactions;
- wind envelopes, capacities, verification passports or optimization results.

The lifecycle is therefore:

```text
read JSON
→ parse and validate schema
→ migrate supported version to current package
→ resolve ProjectInput
→ calculate
```

## Versioning and migration

Readers call the migration dispatcher rather than binding directly to a one-off parser. At present v1 is the only supported schema, so migration is an identity validation step. Future versions are added to that dispatcher and must produce the current canonical package.

Writers always emit the current schema. There is no synthetic v0 compatibility wrapper.

Unknown top-level or nested fields are rejected instead of silently becoming shadow configuration. Semantic constraints such as positive integer module counts and valid guy counts are checked at the package boundary.

## Artifact taxonomy

These formats have intentionally different responsibilities:

| Artifact | Schema / form | Purpose |
| --- | --- | --- |
| Project package | `mast-calculator/project/v1` | Recalculable user input shared by Web/CLI/Desktop |
| Result summary | `mast-calculator/result-summary/v1` | Stable external machine-readable calculation/optimization summary |
| Design package | versioned design package | Accepted calculated construction used by 3D and construction-document workflows |
| Internal calculation snapshot | current internal snapshot schema | Reproducibility/report-generation implementation detail, not a user project or public result API |

The internal calculation snapshot is therefore not a competing project persistence format and must not be consumed as one.

## Web integration

The Web application exposes **Скачать проект JSON** and **Открыть проект JSON**. Both actions use the same parser/serializer and the same grouped `ProjectInput` mapping as the CLI/application boundary. Loaded optional metadata and guy configuration are retained when the project is saved again.

Opening a project never trusts old derived values: the form receives only canonical user input and a subsequent calculation resolves all derived state again.

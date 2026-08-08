# Wind action model `sp20-mean-v1`

Status: implemented by #96 as the **mean-wind foundation** for parent #71. Pulsation/dynamic response is intentionally outside this model and tracked by #97.

## Normative source and model identity

The project baseline is СП 20.13330.2016 «Нагрузки и воздействия», Amendment №6, approved by Ministry of Construction order №597/пр dated 05.09.2024 and effective from 25.09.2024; the wind action model in this slice follows section 11.

The calculation result records the exact identifier:

```text
sp20-mean-v1
```

and structured provenance containing the normative source/edition, wind region, terrain type, basic characteristic pressure `w0`, reference height, `k(ze)` at the reference height, characteristic mean pressure, load reliability factor `γf`, and the separately supplied aerodynamic coefficients.

## Quantities kept separate

This implementation deliberately separates:

1. basic characteristic wind pressure `w0` from the wind region;
2. terrain/height coefficient `k(ze)`;
3. characteristic mean pressure `wm = w0 * k(ze)`;
4. aerodynamic coefficients of members/equipment;
5. load reliability factor `γf` (`windLoadFactor` in the legacy flat resolved contract);
6. pulsation/dynamic response.

`γf = 1.4` is therefore **not** called a dynamic coefficient. No universal `dynamicCoefficient = 2.5` exists in this model.

## Height treatment

For the supported range:

- `ze <= 5 m`: table 11.2 value is used;
- `5 < ze < 10 m`: table 11.2 values at 5 and 10 m are linearly interpolated;
- `10 <= ze <= 300 m`: formula 11.4 is used with table 11.3 parameters;
- `ze > 300 m`: the implementation rejects the calculation instead of silently extrapolating, because project-specific scientific/technical support is required.

For the frame model, a member carries a uniform distributed load. Its characteristic mean pressure is therefore evaluated at the member midpoint height. Equipment pressure is evaluated at the actual top elevation. `γf` is applied after characteristic pressure; aerodynamic coefficients remain separate.

## Aerodynamic coefficient provenance

This slice does **not** claim automatic normative selection of aerodynamic coefficients from an SP20 annex or a special mast/tower standard. The current member and equipment coefficients remain explicit ProjectInput values and are recorded as:

```text
aerodynamicCoefficientSource = project-input-not-sp20-annex
```

with the actual member/equipment coefficient values copied into `windActionProvenance`.

This distinction is intentional: the normative provenance of `w0`, `k(ze)` and `γf` must not make a user-supplied `Cx/Cd` look normatively selected when it is not.

## Manual / legacy-compatible mode

Existing projects without `windActionMode` resolve to:

```text
manual-custom-pressure
```

This keeps the previous `windPressurePa * windLoadFactor * Cd` numerical path unchanged. Beaufort presets remain comparative weather scenarios and are never presented as normative wind regions.

The three new `ProjectInput.environment` fields are optional:

```text
windActionMode
windRegion
windTerrainType
```

so existing `mast-calculator/project/v1` packages remain readable without a schema migration. `windPressurePa` is required for manual/custom input but may be omitted when `sp20-mean-v1` derives the characteristic mean pressure from region/terrain/height.

## Provenance and reporting

The same resolved `windActionProvenance` is carried through:

- `ResolvedProject` / `CalculationResult`;
- every built load case;
- verification passport metadata;
- public paper calculation-project report.

No downstream adapter recalculates `w0` or `k(ze)`.

## Explicitly not verified by this model

`sp20-mean-v1` sets:

```text
meanComponentIncluded = true
pulsationComponentIncluded = false
dynamicResponseIncluded = false
```

Therefore a result using this model must not be described as a complete normative wind-response calculation. #97 will add the frequency/damping-dependent SP20 pulsation and modal/dynamic response with independent eigenproblem/reference validation.

Fabrication, transport and erection stages are separately tracked by #98 and must not be approximated by reusing `γf` or unexplained `1.1/1.4` multipliers.

# Wind action model `sp20-dynamic-v1` — normative source gate

Status: **not yet a selectable production model**. This document defines the source/provenance gate for #102 / parent #97. No pulsation or dynamic coefficient is permitted to affect operational loads until its exact official SP 20 locator and applicability domain are encoded and independently checked.

## Normative identity

The dynamic model will use the same active normative baseline as `sp20-mean-v1`:

```text
СП 20.13330.2016 «Нагрузки и воздействия»
section 11
changes №1…№6
latest listed change: №6
Минстрой России order №597/пр dated 05.09.2024
change №6 effective 25.09.2024
```

Primary-source registry:

- active SP card: `https://protect.gost.ru/sp/details/bac9e1fe-45f1-401b-8e32-949f4ee27821`;
- change №6 card: `https://protect.gost.ru/sp/changesdetails/e26e8b63-c763-4846-a800-a2a79586c725`.

The Rosstandart SP card reports the document as active and currently lists changes №1 through №6. The change №6 card records approval `597/пр`, approval date 05.09.2024, registration 16.09.2024, official publication 17.09.2024 and effective date 25.09.2024.

These URLs are provenance only. Runtime engineering calculations are deterministic/offline and never fetch normative data from the network.

## Structured source registry

`packages/domain/src/sp20-wind-standard.ts` is the single domain-owned identity for this normative edition. It also records the locators already implemented by `sp20-mean-v1`:

| Quantity | Locator |
|---|---|
| basic characteristic pressure `w0` | table 11.1 |
| low-height `k(ze)` values | table 11.2 |
| terrain parameters | table 11.3 |
| height-coefficient expression | formula 11.4 |

The historical `SP20_WIND_MODEL_SOURCE` string is now derived from this structured source and remains byte-for-byte identical so frozen project/report provenance does not change.

## Dynamic fail-closed rule

The registry deliberately exports:

```text
SP20_DYNAMIC_WIND_REFERENCES = []
```

until the exact official source locators for pulsation/dynamic response are verified. This is intentional, not unfinished fallback behavior.

A dynamic implementation commit is allowed only when each newly encoded normative quantity carries:

1. section/clause/table/formula/figure identifier;
2. physical meaning and units;
3. applicability domain (height, frequency, damping, geometry, response regime);
4. interpolation/extrapolation rule where applicable;
5. a hand-checkable fixture tied to the same official source;
6. an explicit statement whether it operates on characteristic mean pressure, pulsation load, modal response or design load effects.

No numerical constant may be introduced solely from memory, an online calculator, a secondary standards summary or the historical `dynamicCoefficient = 2.5` shortcut.

## Versioning boundary

`sp20-mean-v1` remains frozen and continues to mean exactly:

```text
meanComponentIncluded = true
pulsationComponentIncluded = false
dynamicResponseIncluded = false
```

The future `sp20-dynamic-v1` must be a separate model identity that composes, rather than mutates, the mean model. It will reference:

- `sp20-mean-v1` mean-wind provenance;
- modal mass model `frame-lumped-translational-v1` (or an explicitly versioned successor);
- actual natural frequencies/mode shapes from #100;
- explicit damping/logarithmic-decrement provenance;
- a normative regime selection;
- pulsation/spatial-correlation/modal coefficients with source locators;
- separately reported mean and pulsation contributions.

Until that contract is complete, the project must not expose `sp20-dynamic-v1` in `WindActionMode` or in Web/CLI/Desktop input. A half-implemented dynamic mode is less safe than an explicit unavailable mode.

## Numerical veto

This source-registry slice is expected to leave all existing engineering outputs unchanged. Canonical equivalence is a veto gate: if merely structuring the source identity changes any manual or `sp20-mean-v1` calculation/report bytes, the change is rejected rather than updating the baseline.

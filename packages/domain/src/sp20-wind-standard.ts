export const SP20_WIND_STANDARD_SOURCE = 'СП 20.13330.2016 «Нагрузки и воздействия», изм. №6; приказ Минстроя России №597/пр от 05.09.2024; введено 25.09.2024; раздел 11' as const

/**
 * Primary-source identity for the wind-action normative baseline.
 *
 * `officialRegistryUrl` is the Rosstandart card for the active SP. It lists
 * amendments №1…№6 and identifies the document as active. The separate
 * amendment card records approval order 597/пр and the 25.09.2024 effective
 * date. Runtime calculations deliberately do not fetch either URL.
 */
export const SP20_WIND_STANDARD = Object.freeze({
  designation: 'СП 20.13330.2016' as const,
  title: 'Нагрузки и воздействия' as const,
  section: '11' as const,
  amendmentNumber: 6 as const,
  approvalOrder: '597/пр' as const,
  approvedOn: '2024-09-05' as const,
  registeredOn: '2024-09-16' as const,
  officiallyPublishedOn: '2024-09-17' as const,
  effectiveOn: '2024-09-25' as const,
  approvingAuthority: 'Минстрой России' as const,
  officialPublisher: 'Росстандарт' as const,
  officialRegistryUrl: 'https://protect.gost.ru/sp/details/bac9e1fe-45f1-401b-8e32-949f4ee27821' as const,
  amendmentRegistryUrl: 'https://protect.gost.ru/sp/changesdetails/e26e8b63-c763-4846-a800-a2a79586c725' as const,
  sourceLabel: SP20_WIND_STANDARD_SOURCE,
})

export type Sp20NormativeLocatorKind = 'clause' | 'table' | 'formula' | 'figure' | 'annex'

export interface Sp20WindNormativeReference {
  readonly section: '11'
  readonly kind: Sp20NormativeLocatorKind
  readonly id: string
  readonly purpose: string
  readonly status: 'implemented' | 'pending-source-verification'
}

function implementedReference(
  kind: Sp20NormativeLocatorKind,
  id: string,
  purpose: string,
): Sp20WindNormativeReference {
  return Object.freeze({ section: '11', kind, id, purpose, status: 'implemented' })
}

/**
 * Source locators already encoded by the frozen `sp20-mean-v1` model.
 * Keeping these locators structured prevents future dynamic work from
 * introducing anonymous constants or silently changing the normative edition.
 */
export const SP20_MEAN_WIND_REFERENCES = Object.freeze({
  basicWindPressure: implementedReference(
    'table',
    '11.1',
    'basic characteristic wind pressure w0 by wind region',
  ),
  lowHeightCoefficient: implementedReference(
    'table',
    '11.2',
    'height coefficient k(ze) at the tabulated low-height points',
  ),
  terrainParameters: implementedReference(
    'table',
    '11.3',
    'terrain parameters used by the height-coefficient expression',
  ),
  heightCoefficient: implementedReference(
    'formula',
    '11.4',
    'height coefficient k(ze) in the formula-controlled height range',
  ),
})

/**
 * Dynamic locators intentionally remain unpopulated until their exact official
 * SP20 identifiers and applicability domains have been verified from the
 * primary publication. This is a fail-closed boundary: no dynamic coefficient
 * may be encoded merely from memory or a secondary summary.
 */
export const SP20_DYNAMIC_WIND_REFERENCES: readonly Sp20WindNormativeReference[] = Object.freeze([])

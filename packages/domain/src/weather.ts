// Погодные пресеты используют шкалу Бофорта 0–12. Скорости взяты из
// таблицы Met Office: https://weather.metoffice.gov.uk/guides/coast-and-sea/beaufort-scale
// Для Beaufort 0–11 designSpeedMs — округлённая средняя скорость категории,
// указанная Met Office; для Beaufort 12 используется нижний порог 33 м/с.
// Пресет — удобный сценарий, а не замена нормативного ветрового районирования.

export const AIR_DENSITY_KG_M3 = 1.225
export const CUSTOM_WIND_PRESET_ID = 'custom'

export interface WeatherPreset {
  readonly id: string
  readonly beaufort: number | null
  readonly label: string
  readonly range: string | null
  readonly designSpeedMs: number | null
}

export interface WindParameters {
  windPresetId?: string
  windPressurePa?: unknown
  [key: string]: unknown
}

export const WEATHER_PRESETS: ReadonlyArray<Readonly<WeatherPreset>> = Object.freeze([
  Object.freeze({ id: 'bft0', beaufort: 0, label: 'Штиль', range: '< 1 м/с', designSpeedMs: 0 }),
  Object.freeze({ id: 'bft1', beaufort: 1, label: 'Тихий ветер', range: '1–2 м/с', designSpeedMs: 1 }),
  Object.freeze({ id: 'bft2', beaufort: 2, label: 'Лёгкий ветер', range: '2–3 м/с', designSpeedMs: 3 }),
  Object.freeze({ id: 'bft3', beaufort: 3, label: 'Слабый ветер', range: '4–5 м/с', designSpeedMs: 5 }),
  Object.freeze({ id: 'bft4', beaufort: 4, label: 'Умеренный ветер', range: '6–8 м/с', designSpeedMs: 7 }),
  Object.freeze({ id: 'bft5', beaufort: 5, label: 'Свежий ветер', range: '9–11 м/с', designSpeedMs: 10 }),
  Object.freeze({ id: 'bft6', beaufort: 6, label: 'Сильный ветер', range: '11–14 м/с', designSpeedMs: 12 }),
  Object.freeze({ id: 'bft7', beaufort: 7, label: 'Крепкий ветер', range: '14–17 м/с', designSpeedMs: 15 }),
  Object.freeze({ id: 'bft8', beaufort: 8, label: 'Очень крепкий ветер', range: '17–21 м/с', designSpeedMs: 19 }),
  Object.freeze({ id: 'bft9', beaufort: 9, label: 'Шторм', range: '21–24 м/с', designSpeedMs: 23 }),
  Object.freeze({ id: 'bft10', beaufort: 10, label: 'Сильный шторм', range: '25–28 м/с', designSpeedMs: 27 }),
  Object.freeze({ id: 'bft11', beaufort: 11, label: 'Жестокий шторм', range: '29–32 м/с', designSpeedMs: 31 }),
  Object.freeze({ id: 'bft12', beaufort: 12, label: 'Ураган', range: '≥ 33 м/с', designSpeedMs: 33 }),
])

export const WIND_PRESET_OPTIONS: ReadonlyArray<Readonly<WeatherPreset>> = Object.freeze([
  Object.freeze({
    id: CUSTOM_WIND_PRESET_ID,
    beaufort: null,
    label: 'Пользовательское ветровое давление',
    range: null,
    designSpeedMs: null,
  }),
  ...WEATHER_PRESETS,
])

export function windPressureFromSpeedMs(speedMs: unknown, airDensityKgM3: unknown = AIR_DENSITY_KG_M3): number {
  const speed = Number(speedMs)
  const density = Number(airDensityKgM3)
  if (!Number.isFinite(speed) || speed < 0) {
    throw new Error('Скорость ветра должна быть неотрицательным числом')
  }
  if (!Number.isFinite(density) || density <= 0) {
    throw new Error('Плотность воздуха должна быть положительным числом')
  }
  return 0.5 * density * speed ** 2
}

export function windSpeedFromPressurePa(pressurePa: unknown, airDensityKgM3: unknown = AIR_DENSITY_KG_M3): number {
  const pressure = Number(pressurePa)
  const density = Number(airDensityKgM3)
  if (!Number.isFinite(pressure) || pressure < 0) {
    throw new Error('Ветровое давление должно быть неотрицательным числом')
  }
  if (!Number.isFinite(density) || density <= 0) {
    throw new Error('Плотность воздуха должна быть положительным числом')
  }
  return Math.sqrt(2 * pressure / density)
}

export function getWeatherPreset(id: string): Readonly<WeatherPreset> {
  const preset = WIND_PRESET_OPTIONS.find((item) => item.id === id)
  if (!preset) throw new Error(`Неизвестный погодный сценарий: ${id}`)
  return preset
}

export function resolveWindParameters<T extends WindParameters>(parameters: T) {
  const presetId = parameters.windPresetId ?? CUSTOM_WIND_PRESET_ID
  const preset = getWeatherPreset(presetId)

  if (preset.id === CUSTOM_WIND_PRESET_ID) {
    const windPressurePa = Number(parameters.windPressurePa)
    const windSpeedMs = windSpeedFromPressurePa(windPressurePa)
    return {
      ...parameters,
      windPresetId: preset.id,
      windPresetLabel: preset.label,
      beaufortForce: null,
      windSpeedMs,
      windPressurePa,
    }
  }

  const windSpeedMs = preset.designSpeedMs
  if (windSpeedMs == null) throw new Error(`Для погодного сценария ${preset.id} не задана расчётная скорость ветра`)
  return {
    ...parameters,
    windPresetId: preset.id,
    windPresetLabel: `${preset.label} · Бофорт ${preset.beaufort} · ${preset.range}`,
    beaufortForce: preset.beaufort,
    windSpeedMs,
    windPressurePa: windPressureFromSpeedMs(windSpeedMs),
  }
}

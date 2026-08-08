import { previewProjectConfiguration } from '../../packages/application/index.js'
import {
  BOLT_DIAMETERS_MM,
  BOLT_PROPERTY_CLASS_IDS,
  CUSTOM_WIND_PRESET_ID,
  REINFORCEMENT_CLASS_IDS,
  SP20_BASIC_WIND_PRESSURE_PA,
  STANDARD_DIAMETERS_MM,
  STOCK_BAR_DIVISIONS,
  STOCK_BAR_LENGTHS_MM,
  WEATHER_PRESETS,
  WELD_CONSUMABLES,
  WIND_ACTION_MODE_MANUAL,
  WIND_ACTION_MODE_SP20_MEAN_V1,
  getBoltSize,
  getReinforcementClass,
  getWeatherPreset,
} from '../../packages/domain/index.js'
import {
  applyDefaultProjectInputToForm,
  applyProjectInputToForm,
  readProjectInputFromForm,
} from './project-form-dom.js'

const SP20_TERRAIN_TYPES = Object.freeze(['A', 'B', 'C'])

function populateSelect(form, name, values, label = String) {
  const select = form.elements.namedItem(name)
  if (!select) return
  select.replaceChildren(...values.map((value) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label(value)
    return option
  }))
}

export function createMainProjectFormController(form, { materialInfoBox } = {}) {
  function populateCatalogs() {
    populateSelect(form, 'stockBarLengthMm', STOCK_BAR_LENGTHS_MM, (value) => `${value / 1000} м`)
    populateSelect(form, 'stockBarPieces', STOCK_BAR_DIVISIONS, String)
    populateSelect(form, 'barDiameterMm', STANDARD_DIAMETERS_MM, (value) => `Ø${value}`)
    populateSelect(form, 'reinforcementClass', REINFORCEMENT_CLASS_IDS, (value) => getReinforcementClass(value).label)
    populateSelect(form, 'jointBoltDiameterMm', BOLT_DIAMETERS_MM, (value) => {
      const size = getBoltSize(value)
      return `M${size.diameterMm}×${size.pitchMm}`
    })
    populateSelect(form, 'jointBoltClass', BOLT_PROPERTY_CLASS_IDS, String)
    populateSelect(form, 'weldConsumableId', WELD_CONSUMABLES.map((item) => item.id), (id) => (
      WELD_CONSUMABLES.find((item) => item.id === id)?.label ?? id
    ))
    populateSelect(
      form,
      'windActionMode',
      [WIND_ACTION_MODE_MANUAL, WIND_ACTION_MODE_SP20_MEAN_V1],
      (id) => id === WIND_ACTION_MODE_SP20_MEAN_V1
        ? 'СП 20 — нормативная средняя составляющая'
        : 'Заданное давление / погодный сценарий',
    )
    populateSelect(
      form,
      'windRegion',
      ['', ...Object.keys(SP20_BASIC_WIND_PRESSURE_PA)],
      (id) => id ? `${id} — w₀ = ${SP20_BASIC_WIND_PRESSURE_PA[id]} Па` : 'Выберите ветровой район',
    )
    populateSelect(
      form,
      'windTerrainType',
      ['', ...SP20_TERRAIN_TYPES],
      (id) => id ? `Тип ${id}` : 'Выберите тип местности',
    )
    populateSelect(
      form,
      'windPresetId',
      [CUSTOM_WIND_PRESET_ID, ...WEATHER_PRESETS.map((preset) => preset.id)],
      (id) => {
        const preset = getWeatherPreset(id)
        return preset.id === CUSTOM_WIND_PRESET_ID
          ? preset.label
          : `Бофорт ${preset.beaufort}: ${preset.label} · ${preset.range}`
      },
    )
  }

  function readProjectInput() {
    return readProjectInputFromForm(form)
  }

  function preview() {
    return previewProjectConfiguration(readProjectInput())
  }

  function syncWindFields() {
    const envelope = form.elements.namedItem('windEnvelopeEnabled')?.checked ?? false
    const direction = form.elements.namedItem('windDirectionDeg')
    const step = form.elements.namedItem('windEnvelopeStepDeg')
    if (direction) direction.disabled = envelope
    if (step) step.disabled = !envelope
  }

  function windActionMode() {
    return form.elements.namedItem('windActionMode')?.value || WIND_ACTION_MODE_MANUAL
  }

  function syncWindActionFields() {
    const normative = windActionMode() === WIND_ACTION_MODE_SP20_MEAN_V1
    const region = form.elements.namedItem('windRegion')
    const terrain = form.elements.namedItem('windTerrainType')
    const preset = form.elements.namedItem('windPresetId')
    if (region) region.disabled = !normative
    if (terrain) terrain.disabled = !normative
    if (preset) {
      preset.disabled = normative
      if (normative) preset.value = CUSTOM_WIND_PRESET_ID
    }
    const note = document.querySelector('#wind-action-note')
    if (note) {
      note.textContent = normative
        ? 'СП 20: здесь рассчитывается только средняя составляющая w₀·k(ze)·γf. Пульсация и динамический отклик ещё не включены и будут отдельной проверкой.'
        : 'Пользовательское давление и шкала Бофорта являются сценариями нагрузки, а не нормативным ветровым районированием.'
    }
    syncWindPresetFields()
  }

  function syncWindPresetFields() {
    const pressureInput = form.elements.namedItem('windPressurePa')
    const speedInput = form.elements.namedItem('windSpeedMs')
    if (!pressureInput || !speedInput) return
    const normative = windActionMode() === WIND_ACTION_MODE_SP20_MEAN_V1
    const region = form.elements.namedItem('windRegion')?.value
    const terrain = form.elements.namedItem('windTerrainType')?.value
    pressureInput.readOnly = normative
    if (normative && (!region || !terrain)) {
      pressureInput.value = ''
      speedInput.value = ''
      return
    }
    const resolved = preview()
    pressureInput.readOnly = normative || !resolved.weather.custom
    pressureInput.value = resolved.weather.pressurePa.toFixed(1)
    speedInput.value = resolved.weather.speedMs.toFixed(2)
  }

  function syncFabricationFields() {
    const resolved = preview()
    const ribCutLength = form.elements.namedItem('ribCutLengthMm')
    const moduleHeight = form.elements.namedItem('moduleHeightMm')
    if (ribCutLength) ribCutLength.value = resolved.geometry.ribCutLengthMm.toFixed(2)
    if (moduleHeight) moduleHeight.value = resolved.geometry.moduleHeightMm.toFixed(2)
    if (materialInfoBox) {
      const material = resolved.material
      materialInfoBox.textContent = `${material.label}, ${material.standard}: Ry = ${material.yieldStrengthMPa} МПа, Rm = ${material.tensileStrengthMPa} МПа, E = ${material.youngModulusGPa} ГПа, ν = ${material.poissonRatio}.`
    }
  }

  function applyProjectInput(projectInput) {
    applyProjectInputToForm(form, projectInput)
    syncWindFields()
    syncWindActionFields()
    syncFabricationFields()
  }

  function attach() {
    form.elements.namedItem('windEnvelopeEnabled')?.addEventListener('change', syncWindFields)
    form.elements.namedItem('windActionMode')?.addEventListener('change', syncWindActionFields)
    form.elements.namedItem('windRegion')?.addEventListener('change', syncWindPresetFields)
    form.elements.namedItem('windTerrainType')?.addEventListener('change', syncWindPresetFields)
    form.elements.namedItem('windPresetId')?.addEventListener('change', syncWindPresetFields)
    form.elements.namedItem('windPressurePa')?.addEventListener('input', () => {
      if (
        windActionMode() === WIND_ACTION_MODE_MANUAL
        && form.elements.namedItem('windPresetId')?.value === CUSTOM_WIND_PRESET_ID
      ) syncWindPresetFields()
    })
    form.elements.namedItem('stockBarLengthMm')?.addEventListener('change', syncFabricationFields)
    form.elements.namedItem('stockBarPieces')?.addEventListener('change', syncFabricationFields)
    form.elements.namedItem('reinforcementClass')?.addEventListener('change', syncFabricationFields)
  }

  populateCatalogs()
  applyDefaultProjectInputToForm(form)
  attach()
  syncWindFields()
  syncWindActionFields()
  syncFabricationFields()

  return Object.freeze({
    readProjectInput,
    applyProjectInput,
    syncWindFields,
    syncWindActionFields,
    syncWindPresetFields,
    syncFabricationFields,
  })
}

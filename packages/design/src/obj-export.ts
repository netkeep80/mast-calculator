import {
  buildDetailedMastModel,
  type DetailedMastOptions,
} from './detailed-mast-model.js'

type DetailedMastResult = Parameters<typeof buildDetailedMastModel>[0]

function cleanNumber(value: unknown): string {
  const number = Math.abs(Number(value)) < 5e-10 ? 0 : Number(value)
  if (!Number.isFinite(number)) throw new Error('OBJ содержит нечисловую координату')
  return number.toFixed(6).replace(/\.?0+$/, '') || '0'
}

function objectName(value: unknown): string {
  return String(value)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'object'
}

export function createMastObj(
  result: DetailedMastResult,
  options: DetailedMastOptions = {},
): string {
  const model = buildDetailedMastModel(result, options)
  const lines = [
    '# mast-calculator detailed Wavefront OBJ export',
    '# units: millimeters; Z axis: mast vertical',
    '# members use FEM centerlines with real bar diameter',
    '# joint solids use selected hardware dimensions; thread profile and weld bead are intentionally not modeled',
  ]
  let vertexOffset = 0
  let currentGroup: unknown = null

  for (const object of model.objects) {
    if (object.group !== currentGroup) {
      currentGroup = object.group
      lines.push(`g ${objectName(currentGroup)}`)
    }
    lines.push(`o ${objectName(object.name)}`)
    for (const vertex of object.vertices) lines.push(`v ${vertex.map(cleanNumber).join(' ')}`)
    for (const face of object.faces) {
      lines.push(`f ${face.map((index) => vertexOffset + index + 1).join(' ')}`)
    }
    vertexOffset += object.vertices.length
  }

  lines.push('s off')
  lines.push(`# summary: vertices=${model.statistics.vertices}, faces=${model.statistics.faces}, objects=${model.statistics.objects}`)
  lines.push(`# structural members=${model.statistics.structuralMembers}`)
  lines.push(`# joint hardware objects=${model.statistics.hardwareObjects}`)
  return `${lines.join('\n')}\n`
}

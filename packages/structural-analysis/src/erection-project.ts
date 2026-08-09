import type { ProjectTiltUpErectionInput } from '../../domain/contracts.js'
import type { GeneratedMastModel } from './geometry.js'
import type { ErectionEnvelopeOptions, ErectionPathInput } from './erection-envelope.js'

export interface ResolvedErectionTopology {
  readonly hingeBaseEdgeIndex: 0 | 1 | 2
  readonly hingeNodeIds: readonly [number, number]
  readonly attachmentTopCornerIndex: 0 | 1 | 2
  readonly attachmentNodeId: number
}

export interface ResolvedProjectErectionPath {
  readonly topology: ResolvedErectionTopology
  readonly path: ErectionPathInput
  readonly options: ErectionEnvelopeOptions
}

function triangleNode(
  nodeIds: readonly number[],
  corner: 0 | 1 | 2,
  role: string,
): number {
  if (nodeIds.length !== 3) throw new Error(`${role}: ожидается ровно три узла треугольной грани`)
  const nodeId = nodeIds[corner]
  if (nodeId === undefined) throw new Error(`${role}: не найден угол ${corner}`)
  return nodeId
}

/**
 * Resolves durable topology-relative erection selectors to the current generated
 * FEM topology. Raw node IDs never enter the persisted project package.
 */
export function resolveProjectErectionPath(
  model: GeneratedMastModel,
  input: ProjectTiltUpErectionInput,
): ResolvedProjectErectionPath {
  const edge = input.hingeBaseEdgeIndex
  const nextCorner = ((edge + 1) % 3) as 0 | 1 | 2
  const hingeNodeIds: readonly [number, number] = [
    triangleNode(model.baseNodeIds, edge, 'Монтажный шарнир'),
    triangleNode(model.baseNodeIds, nextCorner, 'Монтажный шарнир'),
  ]
  const attachmentNodeId = triangleNode(
    model.topNodeIds,
    input.attachmentTopCornerIndex,
    'Точка крепления монтажного троса',
  )

  return Object.freeze({
    topology: Object.freeze({
      hingeBaseEdgeIndex: edge,
      hingeNodeIds: Object.freeze([...hingeNodeIds]) as unknown as readonly [number, number],
      attachmentTopCornerIndex: input.attachmentTopCornerIndex,
      attachmentNodeId,
    }),
    path: Object.freeze({
      hingeNodeIds,
      attachmentNodeId,
      anchorPointM: input.anchorPointM,
      rotationSense: input.rotationSense,
      startAngleDeg: input.startAngleDeg,
      endAngleDeg: input.endAngleDeg,
    }),
    options: Object.freeze({
      initialSegments: input.sampling.initialSegments,
      relativeTolerance: input.sampling.relativeTolerance,
      minimumStep: input.sampling.minimumAngleStepDeg,
      maximumEvaluations: input.sampling.maximumEvaluations,
      maximumDepth: input.sampling.maximumDepth,
    }),
  })
}

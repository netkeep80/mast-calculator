export interface AdaptiveSampleEvaluation<T> {
  readonly state: T
  readonly metrics: readonly number[]
  readonly continuityKey: string
}

export interface AdaptiveSample<T> extends AdaptiveSampleEvaluation<T> {
  readonly x: number
}

export interface AdaptiveSamplingOptions {
  readonly initialSegments?: number
  readonly relativeTolerance?: number
  readonly minimumStep?: number
  readonly maximumEvaluations?: number
  readonly maximumDepth?: number
}

export interface AdaptiveSamplingDiagnostics {
  readonly evaluationCount: number
  readonly cacheHits: number
  readonly maximumDepthReached: number
  readonly minimumResolvedStep: number
  readonly converged: boolean
  readonly reason: 'tolerance' | 'max-evaluations' | 'max-depth'
}

export interface AdaptiveSamplingResult<T> {
  readonly samples: readonly AdaptiveSample<T>[]
  readonly diagnostics: AdaptiveSamplingDiagnostics
}

interface ResolvedAdaptiveSamplingOptions {
  readonly initialSegments: number
  readonly relativeTolerance: number
  readonly minimumStep: number
  readonly maximumEvaluations: number
  readonly maximumDepth: number
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < 1 || Math.floor(resolved) !== resolved) {
    throw new RangeError(`${name} must be a positive integer`)
  }
  return resolved
}

function resolveOptions(options: AdaptiveSamplingOptions, span: number): ResolvedAdaptiveSamplingOptions {
  const relativeTolerance = options.relativeTolerance ?? 0.02
  if (!Number.isFinite(relativeTolerance) || relativeTolerance <= 0) {
    throw new RangeError('relativeTolerance must be finite and > 0')
  }
  const minimumStep = options.minimumStep ?? Math.max(span / 360, Number.EPSILON)
  if (!Number.isFinite(minimumStep) || minimumStep <= 0) {
    throw new RangeError('minimumStep must be finite and > 0')
  }
  return {
    initialSegments: positiveInteger(options.initialSegments, 6, 'initialSegments'),
    relativeTolerance,
    minimumStep,
    maximumEvaluations: positiveInteger(options.maximumEvaluations, 49, 'maximumEvaluations'),
    maximumDepth: positiveInteger(options.maximumDepth, 12, 'maximumDepth'),
  }
}

function validateEvaluation<T>(evaluation: AdaptiveSampleEvaluation<T>, expectedMetricCount: number | null): number {
  if (typeof evaluation.continuityKey !== 'string' || evaluation.continuityKey.length === 0) {
    throw new Error('adaptive sample continuityKey must be a non-empty string')
  }
  const metricCount = evaluation.metrics.length
  if (expectedMetricCount !== null && metricCount !== 0 && expectedMetricCount !== 0 && metricCount !== expectedMetricCount) {
    throw new Error('adaptive sample metric vector length changed inside one continuity domain')
  }
  for (const metric of evaluation.metrics) {
    if (!Number.isFinite(metric)) throw new Error('adaptive sample metrics must be finite')
  }
  return metricCount
}

function normalizedMidpointError(left: number, midpoint: number, right: number): number {
  const linearMidpoint = (left + right) / 2
  const scale = Math.max(1e-12, Math.abs(left), Math.abs(midpoint), Math.abs(right))
  return Math.abs(midpoint - linearMidpoint) / scale
}

function needsRefinement<T>(
  left: AdaptiveSample<T>,
  midpoint: AdaptiveSample<T>,
  right: AdaptiveSample<T>,
  relativeTolerance: number,
): boolean {
  if (
    left.continuityKey !== midpoint.continuityKey
    || midpoint.continuityKey !== right.continuityKey
  ) return true
  if (midpoint.metrics.length === 0) return false
  if (left.metrics.length !== midpoint.metrics.length || right.metrics.length !== midpoint.metrics.length) return true
  for (let index = 0; index < midpoint.metrics.length; index += 1) {
    if (normalizedMidpointError(left.metrics[index]!, midpoint.metrics[index]!, right.metrics[index]!) > relativeTolerance) {
      return true
    }
  }
  return false
}

function minimumSampleSpacing<T>(samples: readonly AdaptiveSample<T>[], fallback: number): number {
  let minimum = fallback
  for (let index = 0; index < samples.length - 1; index += 1) {
    minimum = Math.min(minimum, samples[index + 1]!.x - samples[index]!.x)
  }
  return minimum
}

/**
 * Deterministic adaptive sampler for a scalar interval and one or more smooth
 * response metrics. A continuity-key change is treated as a physical/regime
 * boundary and refined from both sides rather than interpolated through.
 */
export function adaptiveSampleRange<T>(
  start: number,
  end: number,
  evaluate: (x: number) => AdaptiveSampleEvaluation<T>,
  options: AdaptiveSamplingOptions = {},
): AdaptiveSamplingResult<T> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    throw new RangeError('adaptive sampling range must be finite and end > start')
  }
  const span = end - start
  const resolved = resolveOptions(options, span)
  if (resolved.maximumEvaluations < resolved.initialSegments + 1) {
    throw new RangeError('maximumEvaluations must fit the complete initial grid')
  }

  const cache = new Map<string, AdaptiveSample<T>>()
  let cacheHits = 0
  let expectedMetricCount: number | null = null
  let maximumDepthReached = 0
  let budgetExhausted = false
  let depthLimited = false

  const sample = (x: number): AdaptiveSample<T> | null => {
    const key = x.toPrecision(15)
    const existing = cache.get(key)
    if (existing) {
      cacheHits += 1
      return existing
    }
    if (cache.size >= resolved.maximumEvaluations) {
      budgetExhausted = true
      return null
    }
    const evaluation = evaluate(x)
    const metricCount = validateEvaluation(evaluation, expectedMetricCount)
    if (metricCount > 0 && expectedMetricCount === null) expectedMetricCount = metricCount
    const created: AdaptiveSample<T> = Object.freeze({
      x,
      state: evaluation.state,
      metrics: Object.freeze([...evaluation.metrics]),
      continuityKey: evaluation.continuityKey,
    })
    cache.set(key, created)
    return created
  }

  const initial: AdaptiveSample<T>[] = []
  for (let index = 0; index <= resolved.initialSegments; index += 1) {
    const x = index === resolved.initialSegments
      ? end
      : start + span * index / resolved.initialSegments
    const current = sample(x)
    if (!current) throw new Error('adaptive sampler could not build its declared initial grid')
    initial.push(current)
  }

  const refine = (left: AdaptiveSample<T>, right: AdaptiveSample<T>, depth: number): void => {
    const width = right.x - left.x
    maximumDepthReached = Math.max(maximumDepthReached, depth)
    if (width <= resolved.minimumStep) return
    const midpointX = (left.x + right.x) / 2
    const midpoint = sample(midpointX)
    if (!midpoint) return
    const refineFurther = needsRefinement(left, midpoint, right, resolved.relativeTolerance)
    if (!refineFurther) return
    if (depth >= resolved.maximumDepth) {
      depthLimited = true
      return
    }
    refine(left, midpoint, depth + 1)
    refine(midpoint, right, depth + 1)
  }

  for (let index = 0; index < initial.length - 1; index += 1) {
    refine(initial[index]!, initial[index + 1]!, 1)
    if (budgetExhausted) break
  }

  const samples = [...cache.values()].sort((left, right) => left.x - right.x)
  const reason = budgetExhausted ? 'max-evaluations' : depthLimited ? 'max-depth' : 'tolerance'
  return {
    samples,
    diagnostics: {
      evaluationCount: cache.size,
      cacheHits,
      maximumDepthReached,
      minimumResolvedStep: minimumSampleSpacing(samples, span),
      converged: !budgetExhausted && !depthLimited,
      reason,
    },
  }
}

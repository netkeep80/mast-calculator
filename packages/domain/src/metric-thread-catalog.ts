export const METRIC_THREAD_STANDARD = 'ISO 262:2023 / ISO 261 / ISO 724:2023; ГОСТ 24705-2004 для базовых размеров метрической резьбы'

export interface MetricThread {
  readonly diameterMm: number
  readonly pitchMm: number
  readonly designation: string
  readonly standard: string
}

// Selected commercial fastener sizes of ISO 262:2023, coarse pitch, M1…M100.
// Каталог резьбы отделён от расчётного ряда конструкционных болтов: наличие
// стандартной коммерческой резьбы не означает автоматически наличие
// нормативных Ab/Abn и Rbs/Rbt для расчёта болта по СП 16.
const METRIC_COARSE_THREAD_DATA: ReadonlyArray<readonly [number, number]> = [
  [1, 0.25], [1.2, 0.25], [1.4, 0.3], [1.6, 0.35], [1.8, 0.35],
  [2, 0.4], [2.5, 0.45], [3, 0.5], [3.5, 0.6], [4, 0.7], [5, 0.8],
  [6, 1], [7, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2],
  [16, 2], [18, 2.5], [20, 2.5], [22, 2.5], [24, 3], [27, 3],
  [30, 3.5], [33, 3.5], [36, 4], [39, 4], [42, 4.5], [45, 4.5],
  [48, 5], [52, 5], [56, 5.5], [60, 5.5], [64, 6], [68, 6],
  [72, 6], [76, 6], [80, 6], [85, 6], [90, 6], [95, 6], [100, 6],
]

export const METRIC_COARSE_THREADS: ReadonlyArray<Readonly<MetricThread>> = Object.freeze(
  METRIC_COARSE_THREAD_DATA.map(([diameterMm, pitchMm]) => Object.freeze({
    diameterMm,
    pitchMm,
    designation: `M${diameterMm}`,
    standard: METRIC_THREAD_STANDARD,
  })),
)

export const METRIC_COARSE_THREAD_DIAMETERS_MM = Object.freeze(
  METRIC_COARSE_THREADS.map((item) => item.diameterMm),
)

export function getMetricCoarseThread(diameterMm: unknown): Readonly<MetricThread> {
  const diameter = Number(diameterMm)
  const thread = METRIC_COARSE_THREADS.find((item) => item.diameterMm === diameter)
  if (!thread) throw new Error(`M${diameterMm} отсутствует в выбранном коммерческом ряду ISO 262:2023`)
  return thread
}

export function metricThreadStressAreaMm2(diameterMm: unknown, pitchMm: unknown = null): number {
  const thread = pitchMm == null ? getMetricCoarseThread(diameterMm) : {
    diameterMm: Number(diameterMm),
    pitchMm: Number(pitchMm),
  }
  if (!(thread.diameterMm > 0) || !(thread.pitchMm > 0)) {
    throw new Error('Диаметр и шаг резьбы должны быть положительными')
  }
  return Math.PI / 4 * (thread.diameterMm - 0.9382 * thread.pitchMm) ** 2
}

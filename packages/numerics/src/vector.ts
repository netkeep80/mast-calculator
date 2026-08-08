export type Vector3 = readonly [number, number, number]
export type MutableVector3 = [number, number, number]

export const add3 = (a: Vector3, b: Vector3): MutableVector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub3 = (a: Vector3, b: Vector3): MutableVector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale3 = (a: Vector3, scalar: number): MutableVector3 => [a[0] * scalar, a[1] * scalar, a[2] * scalar]
export const dot3 = (a: Vector3, b: Vector3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const norm3 = (a: Vector3): number => Math.hypot(a[0], a[1], a[2])
export const cross3 = (a: Vector3, b: Vector3): MutableVector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const unit3 = (a: Vector3): MutableVector3 => {
  const length = norm3(a)
  if (length <= Number.EPSILON) throw new Error('Невозможно нормировать нулевой вектор')
  return scale3(a, 1 / length)
}

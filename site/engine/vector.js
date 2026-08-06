export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale3 = (a, scalar) => [a[0] * scalar, a[1] * scalar, a[2] * scalar]
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const norm3 = (a) => Math.hypot(a[0], a[1], a[2])
export const unit3 = (a) => {
  const length = norm3(a)
  if (length <= Number.EPSILON) throw new Error('Невозможно нормировать нулевой вектор')
  return scale3(a, 1 / length)
}

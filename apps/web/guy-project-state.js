let readCurrentGuys = () => null

export function bindCurrentProjectGuysReader(reader) {
  readCurrentGuys = typeof reader === 'function' ? reader : () => null
}

export function currentProjectGuys() {
  return readCurrentGuys() ?? null
}

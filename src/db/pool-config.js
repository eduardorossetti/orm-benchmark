export const POOL_MAX = Number(process.env.POOL_MAX ?? 20)
export const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS ?? 30000)
export const CONNECTION_TIMEOUT_MS = Number(process.env.CONNECTION_TIMEOUT_MS ?? 10000)

export const pgPoolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
}

if (process.env.ANALYZE_MODE) {
  const pg = await import('pg')
  const Pool = pg.default?.Pool ?? pg.Pool
  const originalQuery = Pool.prototype.query
  Pool.prototype.query = function (textOrConfig, values, callback) {
    globalThis.__capturedQueries ??= []
    const text = typeof textOrConfig === 'string'
      ? textOrConfig
      : (textOrConfig?.text ?? String(textOrConfig))
    const params = Array.isArray(values)
      ? values
      : (textOrConfig?.values ?? [])
    globalThis.__capturedQueries.push({ query: text, params })
    return originalQuery.call(this, textOrConfig, values, callback)
  }
}

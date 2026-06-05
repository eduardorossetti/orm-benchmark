import { resetFast } from '../src/db/snapshot.js'

const t0 = performance.now()
await resetFast()
const ms = (performance.now() - t0).toFixed(0)
console.log(`Reset OK (TRUNCATE + COPY + ANALYZE + CHECKPOINT) — ${ms}ms`)

import { snapshot, TABLES } from '../src/db/snapshot.js'

const t0 = performance.now()
await snapshot()
const ms = (performance.now() - t0).toFixed(0)
console.log(`Snapshot OK: ${TABLES.join(', ')} → results/.snapshot/*.csv (${ms}ms)`)

import { parseArgs } from 'node:util'
import { writeFileSync } from 'node:fs'
import { scenarios } from './src/scenarios.js'
import { sqlStrategy } from './src/strategies/sql.js'
import { drizzleStrategy } from './src/strategies/drizzle.js'
import { prismaStrategy } from './src/strategies/prisma.js'
import { prismaQueryStrategy } from './src/strategies/prisma-query.js'
import { runScenario } from './src/bench/runner.js'
import { fmt } from './src/bench/stats.js'
import { resetFast } from './src/db/snapshot.js'

const STRATEGIES = {
  sql:            sqlStrategy,
  drizzle:        drizzleStrategy,
  prisma:         prismaStrategy,
  'prisma-query': prismaQueryStrategy,
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    iterations: { type: 'string', default: '50' },
    warmup:     { type: 'string', default: '10' },
    csv:        { type: 'boolean', default: false },
    help:       { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

if (values.help || positionals.length === 0) {
  console.log(`
Uso: node --env-file=.env bench.js <strategy> [scenario] [--flags]

Estratégias disponíveis: ${Object.keys(STRATEGIES).join(', ')}
Cenários disponíveis:    ${Object.keys(scenarios).join(', ')}

Flags:
  --iterations=N   Número de iterações medidas (default: 50)
  --warmup=N       Número de iterações de warm-up descartadas (default: 10)
  --csv            Gera CSV em results/<strategy>_<timestamp>.csv

Exemplos:
  node --env-file=.env bench.js sql
  node --env-file=.env bench.js sql select_by_id
  node --env-file=.env bench.js sql --iterations=100 --csv
  `)
  process.exit(0)
}

const [strategyId, scenarioFilter] = positionals
const strategy = STRATEGIES[strategyId]

if (!strategy) {
  console.error(`Estratégia desconhecida: ${strategyId}`)
  process.exit(1)
}

const toRun = scenarioFilter
  ? { [scenarioFilter]: scenarios[scenarioFilter] }
  : scenarios

if (scenarioFilter && !scenarios[scenarioFilter]) {
  console.error(`Cenário desconhecido: ${scenarioFilter}`)
  process.exit(1)
}

const iterations = Number(values.iterations)
const warmup     = Number(values.warmup)

console.log(`\nEstratégia: ${strategy.name}`)
console.log(`Iterações:  ${iterations} (warm-up ${warmup} descartado)`)
if (iterations < 100) {
  console.log('Aviso: p99 só fica significativo com --iterations=100+ (com 50 iterações p99 ≈ max).')
}
console.log('')

try {
  const rows = []
  for (const [id, scenario] of Object.entries(toRun)) {
    process.stdout.write(`> ${id.padEnd(24)} ... `)
    await resetFast()
    const stats = await runScenario(scenario, id, strategy, { warmup, iterations })
    console.log(`mediana ${fmt(stats.median)}ms  p95 ${fmt(stats.p95)}ms`)
    rows.push({
      strategy: strategy.name,
      scenario: id,
      category: scenario.category,
      ...stats,
    })
  }

  console.log('\nResumo:')
  console.table(rows.map(r => ({
    cenário:  r.scenario,
    categoria: r.category,
    min:      fmt(r.min),
    mediana:  fmt(r.median),
    média:    fmt(r.mean),
    p95:      fmt(r.p95),
    p99:      fmt(r.p99),
    max:      fmt(r.max),
  })))

  if (values.csv) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `results/${strategy.name}_${ts}.csv`
    const header = 'strategy,scenario,category,n,min,median,mean,p95,p99,max\n'
    const body = rows.map(r =>
      [r.strategy, r.scenario, r.category, r.n, r.min, r.median, r.mean, r.p95, r.p99, r.max].join(',')
    ).join('\n')
    writeFileSync(path, header + body + '\n')
    console.log(`\nCSV salvo em ${path}`)
  }
} finally {
  await strategy.cleanup()
}

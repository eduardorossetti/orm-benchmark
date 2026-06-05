import postgres from 'postgres'
import { writeFileSync, mkdirSync } from 'node:fs'

if (!process.env.ANALYZE_MODE) {
  console.error('ERRO: rode com ANALYZE_MODE=1 (necessário para o debug do postgres.js capturar queries)')
  process.exit(1)
}

const { scenarios, seedScenarioParams } = await import('./src/scenarios.js')
const { sqlStrategy }         = await import('./src/strategies/sql.js')
const { drizzleStrategy }     = await import('./src/strategies/drizzle.js')
const { prismaStrategy }      = await import('./src/strategies/prisma.js')
const { prismaQueryStrategy } = await import('./src/strategies/prisma-query.js')
const { resetFast }           = await import('./src/db/snapshot.js')

const STRATEGIES = {
  sql:            sqlStrategy,
  drizzle:        drizzleStrategy,
  prisma:         prismaStrategy,
  'prisma-query': prismaQueryStrategy,
}

mkdirSync('results/explain', { recursive: true })

const explainSql = postgres(process.env.DATABASE_URL)

function inlineParams(query, params) {
  if (!params || params.length === 0) return query
  return query.replace(/\$(\d+)/g, (_, n) => formatLiteral(params[Number(n) - 1]))
}

function formatLiteral(val) {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number')  return String(val)
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'bigint')  return String(val)
  if (val instanceof Date)      return `'${val.toISOString()}'::timestamp`
  if (Array.isArray(val)) {
    if (val.length === 0) return 'ARRAY[]::text[]'
    return `ARRAY[${val.map(formatLiteral).join(',')}]`
  }
  return `'${String(val).replace(/'/g, "''")}'`
}

function isNoise(q) {
  const t = q.trim().toUpperCase()
  return t.startsWith('BEGIN')   || t.startsWith('COMMIT')   || t.startsWith('ROLLBACK')
      || t.startsWith('SET ')    || t.startsWith('SHOW ')    || t.startsWith('DISCARD')
      || t.startsWith('DEALLOCATE') || t.startsWith('PREPARE') || t.startsWith('LISTEN')
      || t.includes('PG_CATALOG.') || t.includes('INFORMATION_SCHEMA.')
}

const summaryRows = []

for (const [stratName, strat] of Object.entries(STRATEGIES)) {
  console.log(`\n=== ${stratName} ===`)
  for (const [scenName, scen] of Object.entries(scenarios)) {
    await resetFast()
    seedScenarioParams(scenName)
    const params = scen.nextParams()

    globalThis.__capturedQueries = []
    try {
      await strat[scenName](params)
    } catch (err) {
      console.error(`  ✗ ${scenName}: ${err.message}`)
      continue
    }

    const captured = globalThis.__capturedQueries.filter(c => !isNoise(c.query))

    let report  = `# ${stratName} / ${scenName}\n\n`
    report     += `**Cenário:** ${scen.name}\n\n`
    report     += `**Categoria:** ${scen.category}\n\n`
    report     += `**Params do run:** \`${JSON.stringify(params)}\`\n\n`
    report     += `**Queries emitidas (após filtro de ruído):** ${captured.length}\n\n---\n\n`

    let totalExecMs = 0

    for (let i = 0; i < captured.length; i++) {
      const c = captured[i]
      const inlined = inlineParams(c.query, c.params)

      let plan, execMs = 0, planMs = 0
      try {
        const rows = await explainSql.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${inlined}`)
        plan = rows.map(r => r['QUERY PLAN']).join('\n')
        execMs = Number(plan.match(/Execution Time:\s*([\d.]+)\s*ms/)?.[1] ?? 0)
        planMs = Number(plan.match(/Planning Time:\s*([\d.]+)\s*ms/)?.[1] ?? 0)
        totalExecMs += execMs + planMs
      } catch (err) {
        plan = `(EXPLAIN ANALYZE falhou: ${err.message})\n\n-- inlined SQL:\n${inlined}`
      }

      report += `## Query ${i + 1}\n\n`
      report += `- Planning: ${planMs.toFixed(3)} ms\n`
      report += `- Execution: ${execMs.toFixed(3)} ms\n\n`
      report += '**SQL emitido pelo driver:**\n\n```sql\n' + c.query.trim() + '\n```\n\n'
      report += `**Params:** \`${JSON.stringify(c.params)}\`\n\n`
      report += '**Plan (EXPLAIN ANALYZE, BUFFERS):**\n\n```\n' + plan + '\n```\n\n'
    }

    writeFileSync(`results/explain/${stratName}_${scenName}.md`, report)
    summaryRows.push({
      strategy: stratName,
      scenario: scenName,
      queries:  captured.length,
      total_ms: totalExecMs.toFixed(3),
    })
    console.log(`  ✓ ${scenName.padEnd(28)} → ${captured.length} queries (${totalExecMs.toFixed(2)}ms PG)`)
  }
}

let summary = '# Sumário — queries por (strategy, scenario)\n\n'
summary += '| Strategy | Scenario | Queries emitidas | Tempo total no PG (ms) |\n'
summary += '|---|---|---|---|\n'
for (const r of summaryRows) {
  summary += `| ${r.strategy} | ${r.scenario} | ${r.queries} | ${r.total_ms} |\n`
}
writeFileSync('results/explain/_summary.md', summary)
console.log('\nSumário → results/explain/_summary.md')

for (const strat of Object.values(STRATEGIES)) {
  await strat.cleanup()
}
await explainSql.end()

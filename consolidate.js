import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'

const STRATEGIES = ['sql', 'drizzle', 'prisma', 'prisma-query']
const SCENARIOS = [
  'select_by_id', 'cart_detail',
  'n_plus_one', 'eager_join',
  'revenue_by_city_and_category', 'recent_carts_7d',
  'frequently_bought_together', 'products_never_sold', 'browse_catalog_paginated',
  'users_above_avg_spending',
]
const SCENARIO_CATEGORY = {
  select_by_id: 'simples', cart_detail: 'simples',
  n_plus_one: 'anti-padrão', eager_join: 'anti-padrão',
  revenue_by_city_and_category: 'analítico', recent_carts_7d: 'analítico',
  frequently_bought_together: 'analítico', products_never_sold: 'analítico',
  browse_catalog_paginated: 'analítico', users_above_avg_spending: 'analítico',
}
const VUS_LEVELS = [1, 10, 100]

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'bench-dir': { type: 'string', default: 'results' },
    'k6-dir':    { type: 'string', default: 'results/k6' },
    'explain':   { type: 'string', default: 'results/explain/_summary.md' },
    'out-csv':   { type: 'string', default: 'results/consolidated.csv' },
    'out-md':    { type: 'string', default: 'results/consolidated.md' },
    'help':      { type: 'boolean', default: false },
  },
})

if (values.help) {
  console.log(`Uso: node consolidate.js [--bench-dir=results] [--k6-dir=results/k6] [--out-csv=...] [--out-md=...]`)
  process.exit(0)
}

function loadBench(dir) {
  const result = {}
  if (!existsSync(dir)) return result
  const files = readdirSync(dir).filter(f => f.endsWith('.csv') && !f.startsWith('consolidated'))
  const byStrategy = {}
  for (const f of files) {
    const m = f.match(/^([a-z_-]+)_\d{4}-/)
    if (!m) continue
    const strat = m[1]
    if (!STRATEGIES.includes(strat)) continue
    const path = join(dir, f)
    const mtime = statSync(path).mtimeMs
    if (!byStrategy[strat] || byStrategy[strat].mtime < mtime) {
      byStrategy[strat] = { path, mtime }
    }
  }
  for (const [strat, { path }] of Object.entries(byStrategy)) {
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    const header = lines[0].split(',')
    const idx = Object.fromEntries(header.map((h, i) => [h, i]))
    result[strat] = { _source: basename(path), scenarios: {} }
    for (const line of lines.slice(1)) {
      const cols = line.split(',')
      const scen = cols[idx.scenario]
      result[strat].scenarios[scen] = {
        median: Number(cols[idx.median]),
        mean:   Number(cols[idx.mean]),
        p95:    Number(cols[idx.p95]),
        p99:    Number(cols[idx.p99]),
        min:    Number(cols[idx.min]),
        max:    Number(cols[idx.max]),
        n:      Number(cols[idx.n]),
      }
    }
  }
  return result
}

function loadK6(dir) {
  const result = {}
  if (!existsSync(dir)) return result
  const allFiles = readdirSync(dir).filter(f => f.endsWith('.json'))
  for (const strat of STRATEGIES) {
    for (const scen of SCENARIOS) {
      for (const vus of VUS_LEVELS) {
        const prefix = `${strat}_${scen}_${vus}`
        const matches = allFiles.filter(f =>
          f === `${prefix}.json` || f.startsWith(`${prefix}_r`)
        )
        if (matches.length === 0) continue
        const reps = []
        for (const f of matches) {
          let json
          try { json = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { continue }
          const m = json.metrics ?? {}
          reps.push({
            p50: m.http_req_duration?.med ?? null,
            p95: m.http_req_duration?.['p(95)'] ?? null,
            rps: m.http_reqs?.rate ?? null,
            failed_rate: m.http_req_failed?.value ?? 0,
            count: m.http_reqs?.count ?? null,
            threshold_breached: m.http_req_failed?.thresholds?.['rate<0.01'] === true,
          })
        }
        if (reps.length === 0) continue
        const median = (arr) => {
          const s = arr.filter(v => v != null).sort((a, b) => a - b)
          if (s.length === 0) return null
          return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
        }
        const mins = (arr) => { const v = arr.filter(x => x != null); return v.length ? Math.min(...v) : null }
        const maxs = (arr) => { const v = arr.filter(x => x != null); return v.length ? Math.max(...v) : null }
        const p50s = reps.map(r => r.p50)
        const p95s = reps.map(r => r.p95)
        const rpss = reps.map(r => r.rps)
        result[strat] ??= {}
        result[strat][scen] ??= {}
        result[strat][scen][vus] = {
          p50: median(p50s),
          p95: median(p95s),
          rps: median(rpss),
          p50_min: mins(p50s), p50_max: maxs(p50s),
          rps_min: mins(rpss), rps_max: maxs(rpss),
          failed_rate: median(reps.map(r => r.failed_rate)),
          count: reps.reduce((a, r) => a + (r.count ?? 0), 0),
          threshold_ok: !reps.some(r => r.threshold_breached),
          replicas: reps.length,
        }
      }
    }
  }
  return result
}

function loadExplain(path) {
  const result = {}
  if (!existsSync(path)) return result
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*([a-z0-9_-]+)\s*\|\s*([a-z0-9_]+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|/)
    if (!m) continue
    const [, strat, scen, queries, pgMs] = m
    if (!STRATEGIES.includes(strat) || !SCENARIOS.includes(scen)) continue
    result[strat] ??= {}
    result[strat][scen] = { queries: Number(queries), pg_total_ms: Number(pgMs) }
  }
  return result
}

const fmt = (n, d = 2) => n == null || Number.isNaN(n) ? '' : Number(n).toFixed(d)
const fmt0 = (n) => n == null || Number.isNaN(n) ? '' : Math.round(n).toString()
const cell = (v) => v === '' || v == null ? '—' : v
const ratio = (drizzle, sql) => {
  if (drizzle == null || sql == null || sql === 0) return null
  return drizzle / sql
}
const fmtRatio = (r) => r == null ? '—' : `${r.toFixed(2)}×`

const bench   = loadBench(values['bench-dir'])
const k6      = loadK6(values['k6-dir'])
const explain = loadExplain(values['explain'])

const benchCount = Object.values(bench).reduce((a, s) => a + Object.keys(s.scenarios).length, 0)
const k6Count = Object.values(k6).reduce((a, s) =>
  a + Object.values(s).reduce((b, sc) => b + Object.keys(sc).length, 0), 0)

console.log(`Fontes carregadas:`)
console.log(`  bench CSVs:   ${benchCount} pares (strategy × scenario)`)
console.log(`  k6 JSONs:     ${k6Count} runs (strategy × scenario × vus)`)
console.log(`  explain rows: ${Object.values(explain).reduce((a, s) => a + Object.keys(s).length, 0)} pares`)

const csvCols = [
  'strategy', 'scenario', 'category', 'vus',
  'bench_p50_ms', 'bench_p95_ms',
  'k6_p50_ms', 'k6_p95_ms', 'k6_rps',
  'failed_rate', 'pg_queries', 'pg_total_ms',
]
const csvLines = [csvCols.join(',')]
for (const strat of STRATEGIES) {
  for (const scen of SCENARIOS) {
    const b = bench[strat]?.scenarios?.[scen]
    for (const vus of VUS_LEVELS) {
      const k = k6[strat]?.[scen]?.[vus]
      const e = explain[strat]?.[scen]
      const r = {
        strategy: strat, scenario: scen, category: SCENARIO_CATEGORY[scen], vus,
        bench_p50_ms: b?.median, bench_p95_ms: b?.p95,
        k6_p50_ms: k?.p50, k6_p95_ms: k?.p95, k6_rps: k?.rps,
        failed_rate: k?.failed_rate, pg_queries: e?.queries, pg_total_ms: e?.pg_total_ms,
      }
      csvLines.push(csvCols.map(col => r[col] == null ? '' : r[col]).join(','))
    }
  }
}
writeFileSync(values['out-csv'], csvLines.join('\n') + '\n')

let md = `# Resultados consolidados — SQL puro (pg) vs Drizzle vs Prisma\n\n`
md += `**Driver unificado:** todos os 3 caminhos usam \`pg\` (node-postgres). SQL puro chama \`pg.Pool.query\` direto; Drizzle via \`drizzle-orm/node-postgres\`; Prisma via \`@prisma/adapter-pg\`. Driver constante elimina o confounder do driver.\n\n`
md += `**Metodologia em duas camadas** (servidores Node isolados por strategy para evitar viés de contenção):\n`
md += `- **Camada 1 — Latência isolada:** \`bench.js\` sequencial in-process, sem HTTP.\n`
md += `- **Camada 2 — Latência sob carga:** k6 via HTTP, com 1/10/100 VUs concorrentes.\n\n`
md += `**Métrica primária:** *overhead ratio* = ORM / SQL. Valores > 1× indicam ORM mais lento (overhead da abstração); valores < 1× indicam ORM mais rápido (geralmente artefato de fila — ver Discussão).\n\n`

const replicaCounts = new Set()
for (const strat of STRATEGIES) {
  for (const scen of SCENARIOS) {
    for (const vus of VUS_LEVELS) {
      const r = k6[strat]?.[scen]?.[vus]?.replicas
      if (r) replicaCounts.add(r)
    }
  }
}
if (replicaCounts.size > 0) {
  md += `**Réplicas k6:** ${[...replicaCounts].join('/')} runs por célula; valores reportados são mediana entre réplicas.\n\n`
}

md += `## 1. Latência isolada (bench.js — 200 iter, 50 warmup)\n\n`
md += `| cenário | category | SQL p50 | Drizzle p50 | Prisma p50 | Drz/SQL | Pri/SQL | SQL p95 | Drizzle p95 | Prisma p95 |\n`
md += `|---|---|---|---|---|---|---|---|---|---|\n`
for (const scen of SCENARIOS) {
  const sB = bench.sql?.scenarios?.[scen]
  const dB = bench.drizzle?.scenarios?.[scen]
  const pB = bench.prisma?.scenarios?.[scen]
  md += `| ${scen} | ${SCENARIO_CATEGORY[scen]} | ${cell(fmt(sB?.median, 3))} | ${cell(fmt(dB?.median, 3))} | ${cell(fmt(pB?.median, 3))} | ${fmtRatio(ratio(dB?.median, sB?.median))} | ${fmtRatio(ratio(pB?.median, sB?.median))} | ${cell(fmt(sB?.p95, 3))} | ${cell(fmt(dB?.p95, 3))} | ${cell(fmt(pB?.p95, 3))} |\n`
}

md += `\n## 2. Latência sob carga (k6, server isolado por strategy)\n\n`
for (const vus of VUS_LEVELS) {
  md += `### VU = ${vus}\n\n`
  md += `| cenário | category | SQL p50 | Drizzle p50 | Prisma p50 | Drz/SQL | Pri/SQL | SQL rps | Drizzle rps | Prisma rps |\n`
  md += `|---|---|---|---|---|---|---|---|---|---|\n`
  for (const scen of SCENARIOS) {
    const s = k6.sql?.[scen]?.[vus]
    const d = k6.drizzle?.[scen]?.[vus]
    const p = k6.prisma?.[scen]?.[vus]
    md += `| ${scen} | ${SCENARIO_CATEGORY[scen]} | ${cell(fmt(s?.p50))} | ${cell(fmt(d?.p50))} | ${cell(fmt(p?.p50))} | ${fmtRatio(ratio(d?.p50, s?.p50))} | ${fmtRatio(ratio(p?.p50, s?.p50))} | ${cell(fmt0(s?.rps))} | ${cell(fmt0(d?.rps))} | ${cell(fmt0(p?.rps))} |\n`
  }
  md += `\n`
}

md += `## 3. Overhead médio por categoria\n\n`
md += `Média geométrica de overhead p50 (ORM/SQL) por categoria. Valores agregados em bench, k6@1, k6@10, k6@100.\n\n`
const categories = ['simples', 'anti-padrão', 'analítico']
const geomean = (arr) => {
  const valid = arr.filter(v => v != null && v > 0)
  if (valid.length === 0) return null
  return Math.exp(valid.reduce((a, b) => a + Math.log(b), 0) / valid.length)
}
md += `### Drizzle / SQL\n\n`
md += `| categoria | bench | k6 @ VU=1 | k6 @ VU=10 | k6 @ VU=100 |\n|---|---|---|---|---|\n`
for (const cat of categories) {
  const scens = SCENARIOS.filter(s => SCENARIO_CATEGORY[s] === cat)
  const benchRatios = scens.map(s => ratio(bench.drizzle?.scenarios?.[s]?.median, bench.sql?.scenarios?.[s]?.median))
  const k6Ratios = (vus) => scens.map(s => ratio(k6.drizzle?.[s]?.[vus]?.p50, k6.sql?.[s]?.[vus]?.p50))
  md += `| ${cat} | ${fmtRatio(geomean(benchRatios))} | ${fmtRatio(geomean(k6Ratios(1)))} | ${fmtRatio(geomean(k6Ratios(10)))} | ${fmtRatio(geomean(k6Ratios(100)))} |\n`
}
md += `\n### Prisma / SQL\n\n`
md += `| categoria | bench | k6 @ VU=1 | k6 @ VU=10 | k6 @ VU=100 |\n|---|---|---|---|---|\n`
for (const cat of categories) {
  const scens = SCENARIOS.filter(s => SCENARIO_CATEGORY[s] === cat)
  const benchRatios = scens.map(s => ratio(bench.prisma?.scenarios?.[s]?.median, bench.sql?.scenarios?.[s]?.median))
  const k6Ratios = (vus) => scens.map(s => ratio(k6.prisma?.[s]?.[vus]?.p50, k6.sql?.[s]?.[vus]?.p50))
  md += `| ${cat} | ${fmtRatio(geomean(benchRatios))} | ${fmtRatio(geomean(k6Ratios(1)))} | ${fmtRatio(geomean(k6Ratios(10)))} | ${fmtRatio(geomean(k6Ratios(100)))} |\n`
}

md += `\n## 4. Efeito da preview feature \`relationJoins\` (Prisma \`join\` vs \`query\`)\n\n`
md += `Comparação entre Prisma idiomático (default \`join\` = LATERAL JOIN, com \`previewFeatures = ["relationJoins"]\`) e a variante \`prisma-query\` que força \`relationLoadStrategy: 'query'\` (N queries por relação, modo legado).\n\n`
const relJoinScens = SCENARIOS.filter(s => {
  const a = explain.prisma?.[s]?.queries
  const b = explain['prisma-query']?.[s]?.queries
  return a != null && b != null && a !== b
})
const passthroughScens = SCENARIOS.filter(s => !relJoinScens.includes(s))
if (relJoinScens.length === 0) {
  md += `_Sem cenários divergentes detectados via EXPLAIN — pulando seção._\n\n`
} else {
  md += `**${relJoinScens.length} cenários afetados** (divergem em nº de queries no EXPLAIN): ${relJoinScens.join(', ')}.\n`
  md += `**${passthroughScens.length} cenários passthrough** (variante herda do \`prisma\`, sem divergência): ${passthroughScens.join(', ')}.\n\n`

  md += `### Bench (200 iter, 50 warmup)\n\n`
  md += `| cenário | category | Prisma \`join\` p50 | Prisma \`query\` p50 | query/join | queries (join) | queries (query) |\n`
  md += `|---|---|---|---|---|---|---|\n`
  for (const scen of relJoinScens) {
    const j = bench.prisma?.scenarios?.[scen]
    const q = bench['prisma-query']?.scenarios?.[scen]
    const ej = explain.prisma?.[scen]?.queries
    const eq = explain['prisma-query']?.[scen]?.queries
    md += `| ${scen} | ${SCENARIO_CATEGORY[scen]} | ${cell(fmt(j?.median, 3))} | ${cell(fmt(q?.median, 3))} | ${fmtRatio(ratio(q?.median, j?.median))} | ${cell(ej)} | ${cell(eq)} |\n`
  }

  for (const vus of VUS_LEVELS) {
    md += `\n### k6 @ VU = ${vus}\n\n`
    md += `| cenário | category | Prisma \`join\` p50 | Prisma \`query\` p50 | query/join | \`join\` rps | \`query\` rps |\n`
    md += `|---|---|---|---|---|---|---|\n`
    for (const scen of relJoinScens) {
      const j = k6.prisma?.[scen]?.[vus]
      const q = k6['prisma-query']?.[scen]?.[vus]
      md += `| ${scen} | ${SCENARIO_CATEGORY[scen]} | ${cell(fmt(j?.p50))} | ${cell(fmt(q?.p50))} | ${fmtRatio(ratio(q?.p50, j?.p50))} | ${cell(fmt0(j?.rps))} | ${cell(fmt0(q?.rps))} |\n`
    }
  }
  md += `\n`
}

md += `\n## Health-check dos runs k6\n\n`
const issues = []
for (const strat of STRATEGIES) {
  for (const scen of SCENARIOS) {
    for (const vus of VUS_LEVELS) {
      const k = k6[strat]?.[scen]?.[vus]
      if (!k) { issues.push(`- ❌ faltando: ${strat}/${scen}/${vus}`); continue }
      if (k.threshold_ok === false) issues.push(`- threshold falhou: ${strat}/${scen}/${vus} (failed_rate=${fmt(k.failed_rate, 4)})`)
      else if (k.failed_rate > 0)   issues.push(`- erros não-fatais: ${strat}/${scen}/${vus} (failed_rate=${fmt(k.failed_rate, 4)})`)
    }
  }
}
const expected = STRATEGIES.length * SCENARIOS.length * VUS_LEVELS.length
md += issues.length === 0 ? `Todos os ${expected} runs OK.\n` : issues.join('\n') + '\n'

writeFileSync(values['out-md'], md)
console.log(`\nCSV → ${values['out-csv']}`)
console.log(`MD  → ${values['out-md']}`)
if (issues.length > 0) console.log(`\n${issues.length} avisos no health-check (ver MD).`)

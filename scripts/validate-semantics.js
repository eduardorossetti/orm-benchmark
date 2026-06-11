import { scenarios, seedScenarioParams } from '../src/scenarios.js'
import { sqlStrategy }         from '../src/strategies/sql.js'
import { drizzleStrategy }     from '../src/strategies/drizzle.js'
import { prismaStrategy }      from '../src/strategies/prisma.js'
import { resetFast }           from '../src/db/snapshot.js'

const STRATS = {
  sql:            sqlStrategy,
  drizzle:        drizzleStrategy,
  prisma:         prismaStrategy,
}

const TOL = 1e-4

const toNum = (v) => {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v)
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'object' && 'toNumber' in v) return v.toNumber()
  return Number(v)
}

const close = (a, b) => {
  const A = toNum(a), B = toNum(b)
  if (A === 0 && B === 0) return true
  return Math.abs(A - B) / Math.max(Math.abs(A), Math.abs(B)) < TOL
}

const SHAPE = {
  select_by_id: {
    key:   (r) => r.id,
    nums:  () => [],
    order: false,
  },
  cart_detail: {
    key:   (r) => r.id ?? r.item_id ?? r.itemId,
    nums:  (r) => [toNum(r.quantity), toNum(r.unit_price ?? r.unitPrice)],
    order: false,
  },
  n_plus_one: {
    key:   (r) => r.id ?? r.cart_id ?? r.cartId,
    nums:  () => [],
    order: false,
  },
  eager_join: {
    countNormalizer: (rows, sn) => {
      if (sn === 'prisma') {
        return rows.reduce((acc, c) => acc + (c.items?.length || 0), 0)
      }
      return rows.length
    },
    skip: true,
  },
  revenue_by_city_and_category: {
    key:   (r) => `${r.state}|${r.city}|${r.category}`,
    nums:  (r) => [toNum(r.revenue), toNum(r.items_sold ?? r.itemsSold)],
    order: true,
  },
  recent_carts_7d: {
    countNormalizer: (rows, sn) => {
      if (sn === 'prisma') {
        return rows.reduce((acc, c) => acc + (c.items?.length || 0), 0)
      }
      return rows.length
    },
    skip: true,
  },
  frequently_bought_together: {
    key:   (r) => r.product_id ?? r.productId,
    nums:  (r) => [toNum(r.co_occurrences ?? r.coOccurrences)],
    order: true,
  },
  products_never_sold: {
    key:   (r) => r.id,
    nums:  () => [],
    order: false,
  },
  browse_catalog_paginated: {
    key:   (r) => r.id,
    nums:  (r) => [toNum(r.units_sold ?? r.unitsSold)],
    order: true,
  },
  users_above_avg_spending: {
    key:   (r) => r.id,
    nums:  (r) => [toNum(r.spent)],
    order: true,
  },
}

function summarize(rows, scen, sn) {
  if (!Array.isArray(rows)) rows = [rows]
  const shape = SHAPE[scen]
  const count = shape.countNormalizer ? shape.countNormalizer(rows, sn) : rows.length
  if (shape.skip) return { count, keys: null, nums: null }
  const keys = rows.map(shape.key)
  const nums = rows.map(shape.nums)
  return { count, keys, nums }
}

function compare(scen, baselineName, baseline, otherName, other) {
  const shape = SHAPE[scen]
  const diffs = []

  if (baseline.count !== other.count) {
    diffs.push(`count ${baselineName}=${baseline.count} vs ${otherName}=${other.count}`)
  }

  if (shape.skip) {
    return diffs.length ? diffs : null
  }

  if (shape.order) {
    const minLen = Math.min(baseline.keys.length, other.keys.length)
    for (let i = 0; i < minLen; i++) {
      if (String(baseline.keys[i]) !== String(other.keys[i])) {
        diffs.push(`pos ${i}: ${baselineName}=${baseline.keys[i]} vs ${otherName}=${other.keys[i]}`)
        break
      }
    }
  } else {
    const bs = new Set(baseline.keys.map(String))
    const os = new Set(other.keys.map(String))
    const onlyB = [...bs].filter((k) => !os.has(k))
    const onlyO = [...os].filter((k) => !bs.has(k))
    if (onlyB.length) diffs.push(`só em ${baselineName}: ${onlyB.slice(0,3).join(',')}${onlyB.length>3?'…':''}`)
    if (onlyO.length) diffs.push(`só em ${otherName}: ${onlyO.slice(0,3).join(',')}${onlyO.length>3?'…':''}`)
  }

  if (shape.order && baseline.nums.length === other.nums.length) {
    for (let i = 0; i < baseline.nums.length; i++) {
      for (let j = 0; j < baseline.nums[i].length; j++) {
        if (!close(baseline.nums[i][j], other.nums[i][j])) {
          diffs.push(`num pos ${i}[${j}]: ${baselineName}=${baseline.nums[i][j]} vs ${otherName}=${other.nums[i][j]}`)
          break
        }
      }
    }
  }

  return diffs.length ? diffs : null
}

async function main() {
  console.log('Reset DB (snapshot)…')
  await resetFast()

  const order = Object.keys(scenarios)
  const stratNames = Object.keys(STRATS)
  const baseline = 'sql'

  let totalChecks = 0
  let totalOK = 0

  for (const scen of order) {
    seedScenarioParams(scen)
    const params = scenarios[scen].nextParams()
    console.log(`\n=== ${scen} ===`)

    const results = {}
    for (const sn of stratNames) {
      try {
        const r = await STRATS[sn][scen](params)
        results[sn] = summarize(r, scen, sn)
        console.log(`  ${sn.padEnd(13)} count=${results[sn].count}`)
      } catch (err) {
        console.log(`  ${sn.padEnd(13)} ERRO: ${err.message}`)
        results[sn] = { count: -1, keys: [], nums: [] }
      }
    }

    for (const sn of stratNames) {
      if (sn === baseline) continue
      totalChecks++
      const diffs = compare(scen, baseline, results[baseline], sn, results[sn])
      if (diffs) {
        console.log(`  Δ ${baseline} vs ${sn}:`)
        diffs.forEach((d) => console.log(`      - ${d}`))
      } else {
        console.log(`  ✓ ${baseline} ≡ ${sn}`)
        totalOK++
      }
    }
  }

  console.log(`\nResumo: ${totalOK}/${totalChecks} pares equivalentes`)

  for (const sn of stratNames) {
    try { await STRATS[sn].cleanup() } catch {}
  }
  process.exit(totalOK === totalChecks ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })

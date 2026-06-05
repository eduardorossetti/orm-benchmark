import { performance } from 'node:perf_hooks'
import { summarize } from './stats.js'
import { seedScenarioParams } from '../scenarios.js'

export async function runScenario(scenario, scenarioId, strategy, { warmup, iterations }) {
  const fn = strategy[scenarioId]
  if (!fn) throw new Error(`Estratégia "${strategy.name}" não implementa "${scenarioId}"`)

  seedScenarioParams(scenarioId)

  for (let i = 0; i < warmup; i++) {
    await fn(scenario.nextParams())
  }

  const times = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    const params = scenario.nextParams()
    const start  = performance.now()
    await fn(params)
    times[i] = performance.now() - start
  }

  return summarize(times)
}

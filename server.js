import Fastify from 'fastify'
import { faker } from '@faker-js/faker'
import { scenarios } from './src/scenarios.js'

faker.seed(Number(process.env.SEED ?? 12345))

const STRATEGY = process.env.STRATEGY
if (!STRATEGY) {
  console.error('ERRO: env STRATEGY obrigatório (sql | drizzle | prisma | prisma-query)')
  process.exit(1)
}

const STRATEGY_LOADERS = {
  sql:            () => import('./src/strategies/sql.js').then(m => m.sqlStrategy),
  drizzle:        () => import('./src/strategies/drizzle.js').then(m => m.drizzleStrategy),
  prisma:         () => import('./src/strategies/prisma.js').then(m => m.prismaStrategy),
  'prisma-query': () => import('./src/strategies/prisma-query.js').then(m => m.prismaQueryStrategy),
}

const loader = STRATEGY_LOADERS[STRATEGY]
if (!loader) {
  console.error(`ERRO: STRATEGY desconhecida "${STRATEGY}". Válidas: ${Object.keys(STRATEGY_LOADERS).join(', ')}`)
  process.exit(1)
}

const strategy = await loader()

const fastify = Fastify({ logger: false })

fastify.get('/health', async () => ({ ok: true, strategy: STRATEGY }))

fastify.get('/bench/:strategy/:scenario', async (req, reply) => {
  const { strategy: reqStrat, scenario } = req.params
  if (reqStrat !== STRATEGY) {
    return reply.code(404).send({ error: `server carregou "${STRATEGY}", request pediu "${reqStrat}"` })
  }
  const scenObj = scenarios[scenario]
  if (!scenObj) return reply.code(404).send({ error: `unknown scenario: ${scenario}` })
  const params = scenObj.nextParams()
  await strategy[scenario](params)
  return { ok: true }
})

fastify.addHook('onClose', async () => {
  try { await strategy.cleanup() }
  catch (err) { console.error(`cleanup ${STRATEGY}: ${err.message}`) }
})

const port = Number(process.env.PORT ?? 3000)

try {
  await fastify.listen({ port, host: '0.0.0.0' })
  console.log(`Server (${STRATEGY}) escutando em http://localhost:${port}`)
  console.log(`  scenarios: ${Object.keys(scenarios).join(', ')}`)
} catch (err) {
  console.error(err)
  process.exit(1)
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`\nRecebido ${sig}, fechando server (${STRATEGY})...`)
    await fastify.close()
    process.exit(0)
  })
}

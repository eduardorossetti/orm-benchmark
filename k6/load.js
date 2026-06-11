import http from 'k6/http'
import { check } from 'k6'
import { Rate } from 'k6/metrics'

const STRATEGY = __ENV.STRATEGY
const SCENARIO = __ENV.SCENARIO
const VUS      = Number(__ENV.VUS ?? 10)
const DURATION = __ENV.DURATION ?? '30s'
const BASE_URL = __ENV.BASE_URL ?? 'http://localhost:3004'

if (!STRATEGY || !SCENARIO) {
  throw new Error('STRATEGY e SCENARIO são obrigatórios. Ex: STRATEGY=sql SCENARIO=select_by_id k6 run k6/load.js')
}

const URL = `${BASE_URL}/bench/${STRATEGY}/${SCENARIO}`

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
  tags: { strategy: STRATEGY, scenario: SCENARIO, vus: String(VUS) },
}

const errors = new Rate('errors')

export default function () {
  const res = http.get(URL)
  const ok = check(res, {
    'status 200':      (r) => r.status === 200,
    'response is ok':  (r) => r.json('ok') === true,
  })
  errors.add(!ok)
}

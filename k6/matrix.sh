#!/usr/bin/env bash
# Roda matriz isolada: para cada strategy, sobe server dedicado, executa
# todos (cenário, VUs), e mata o server antes de passar para a próxima.
# Isolamento elimina viés de contenção entre múltiplas DB clients no mesmo
# processo Node (descoberto 2026-05-08, ver memória measurement_bias_finding.md).
#
# Total: 3 strategies × 10 cenários × 3 níveis VU × REPLICAS runs.
# Tempo: ~50 min/réplica com DURATION=30s. Default REPLICAS=3 → ~150 min total.
# Réplicas permitem reportar mediana e dispersão entre runs (validade interna).
#
# Server reiniciado a CADA (strategy × scenario × vus) para evitar contaminação
# cruzada via pool de conexões degradado entre cenários (descoberto 2026-05-09).
#
# Pré-requisitos: docker compose up + db:snapshot exportado.

set -euo pipefail

STRATEGIES=(sql drizzle prisma prisma-query)
SCENARIOS=(
  select_by_id
  cart_detail
  n_plus_one
  eager_join
  revenue_by_city_and_category
  recent_carts_7d
  frequently_bought_together
  products_never_sold
  browse_catalog_paginated
  users_above_avg_spending
)
VUS_LEVELS=(1 10 100)

DURATION="${DURATION:-30s}"
PORT="${PORT:-3000}"
BASE_URL="http://localhost:${PORT}"
OUT_DIR="${OUT_DIR:-results/k6}"
# REPLICAS: número de execuções por (strategy × scenario × vus). N≥3 permite
# reportar mediana/IQR entre runs e detectar variância. Default 3 — total ~120 min.
# Para sanity-check rápido use REPLICAS=1.
REPLICAS="${REPLICAS:-3}"

mkdir -p "$OUT_DIR"

total=$(( ${#STRATEGIES[@]} * ${#SCENARIOS[@]} * ${#VUS_LEVELS[@]} * REPLICAS ))
i=0

start_server() {
  local strat=$1
  STRATEGY="$strat" PORT="$PORT" node --env-file=.env server.js > "/tmp/server_${strat}.log" 2>&1 &
  echo $!
}

wait_for_server() {
  for _ in $(seq 1 30); do
    if curl -sf "${BASE_URL}/health" > /dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "ERRO: server não respondeu em 15s" >&2
  return 1
}

stop_server() {
  local pid=$1
  kill -TERM $pid 2>/dev/null || true
  wait $pid 2>/dev/null || true
}

for strat in "${STRATEGIES[@]}"; do
  echo ""
  echo "=== Strategy: ${strat} (server reinicia por cenário) ==="

  for scen in "${SCENARIOS[@]}"; do
    for vus in "${VUS_LEVELS[@]}"; do
      for rep in $(seq 1 $REPLICAS); do
        i=$((i+1))
        out="${OUT_DIR}/${strat}_${scen}_${vus}_r${rep}.json"
        echo "[${i}/${total}] ${strat} / ${scen} / ${vus} VUs / rep ${rep}/${REPLICAS} → ${out}"

        npm run --silent db:reset-fast

        pid=$(start_server "$strat")
        trap "kill $pid 2>/dev/null || true" EXIT
        if ! wait_for_server; then
          cat "/tmp/server_${strat}.log" >&2
          stop_server "$pid"
          continue
        fi

        STRATEGY="$strat" SCENARIO="$scen" VUS="$vus" DURATION="$DURATION" BASE_URL="$BASE_URL" \
          k6 run --quiet --summary-export="$out" k6/load.js || true

        stop_server "$pid"
        trap - EXIT
      done
    done
  done
done

echo ""
echo "Pronto. ${total} runs salvos em ${OUT_DIR}/"

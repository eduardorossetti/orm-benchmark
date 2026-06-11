#!/usr/bin/env bash
# Pipeline completo: limpa resultados antigos, roda matriz k6 + bench + EXPLAIN
# + consolidação. Pré-requisito: docker up + snapshot fresco (reset-fast OK).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "### [$(date '+%H:%M:%S')] clean"
npm run --silent clean

echo "### [$(date '+%H:%M:%S')] loadtest:matrix (270 runs)"
npm run --silent loadtest:matrix

echo "### [$(date '+%H:%M:%S')] bench:full"
npm run --silent bench:full

echo "### [$(date '+%H:%M:%S')] analyze (EXPLAIN)"
npm run --silent analyze

echo "### [$(date '+%H:%M:%S')] consolidate"
npm run --silent consolidate

echo "### [$(date '+%H:%M:%S')] DONE"

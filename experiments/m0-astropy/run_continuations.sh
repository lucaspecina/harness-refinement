#!/bin/bash
# Experimento M0: 4 continuaciones desde el fork en ref1 (2 con nota, 2 sin nota).
# Antes de cada una: mundo reseteado a la foto ref1. Orden intercalado A/B.
set -u
WORK="$(cd "$(dirname "$0")" && pwd)"
PA=/Users/lucaspecina/Desktop/dev/ai/lucaspecina/prime-agent/prime-agent.sh
SCRATCH=/private/tmp/claude-501/-Users-lucaspecina-Desktop-dev-ai-lucaspecina-harness-refinement/41f08aa2-d9cd-42ef-811b-b168421c4907/scratchpad

# Credenciales: exportarlas antes de correr, o dejarlas en un .env local (no versionado).
#   export AZURE_OPENAI_API_KEY=...
#   export AZURE_OPENAI_BASE_URL=https://<tu-recurso>.openai.azure.com
: "${AZURE_OPENAI_API_KEY:?falta AZURE_OPENAI_API_KEY}"
: "${AZURE_OPENAI_BASE_URL:?falta AZURE_OPENAI_BASE_URL}"
export PRIME_AGENT_CODING_AGENT_DIR=$SCRATCH/prime-config
export PATH="$HOME/.local/node22/bin:$PATH"

PROMPT="Continue working on the task until the official verdict from ./run_tests.sh is RESOLVED. Then stop."

declare -a RUNS=(
  "A1:f5722fb8-3d47-480c-8447-c67879e85618-A1.jsonl"
  "B1:365e6195-ebb0-489c-bb28-b63384ae8aa8-B1.jsonl"
  "A2:0f506d42-39d0-45d5-8114-26f79bd73dec-A2.jsonl"
  "B2:a35d5d97-488f-42d3-894a-6bfe442e8e13-B2.jsonl"
)

echo "run,reward,segundos" > "$WORK/forks/results.csv"

for spec in "${RUNS[@]}"; do
  name="${spec%%:*}"; file="${spec#*:}"
  echo "=== [$name] reseteando mundo a ref1 ==="
  rsync -a --delete "$WORK/snapshots/ref1/testbed/" "$WORK/testbed/"
  echo 0 > "$WORK/logs/verifier/reward.txt"
  start=$(date +%s)
  echo "=== [$name] continuando sesion $file ==="
  ( cd "$WORK" && "$PA" --provider azure-openai-responses --model gpt-5.4 \
      --session-dir "$WORK/forks/sessions" \
      --resume "$WORK/forks/sessions/$file" \
      -p "$PROMPT" ) > "$WORK/forks/cont-$name.log" 2>&1
  end=$(date +%s)
  reward=$(cat "$WORK/logs/verifier/reward.txt" 2>/dev/null || echo "?")
  echo "$name,$reward,$((end-start))" >> "$WORK/forks/results.csv"
  echo "=== [$name] reward=$reward en $((end-start))s ==="
done

echo "=== EXPERIMENTO COMPLETO ==="
cat "$WORK/forks/results.csv"

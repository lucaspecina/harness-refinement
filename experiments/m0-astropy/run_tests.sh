#!/bin/bash
# Corre el verificador oficial de la tarea en un contenedor efímero y limpio.
# Al agente solo le mostramos el resumen; el log completo queda en logs/.
set -u
WORK="$(cd "$(dirname "$0")" && pwd)"
IMG=swebench/sweb.eval.x86_64.astropy_1776_astropy-12907
TESTS="$HOME/.cache/harbor/swe-bench_swe-bench-verified/swe-bench-verified/astropy__astropy-12907/tests"

mkdir -p "$WORK/logs/verifier"
docker run --rm --platform linux/amd64 \
  -v "$WORK/testbed:/testbed" \
  -v "$TESTS:/tests:ro" \
  -v "$WORK/logs:/logs" \
  "$IMG" bash -c 'export PATH="$HOME/.local/bin:$PATH" UV_INSTALL_DIR="$HOME/.local/bin"; pip install -q -U --user uv 2>/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh; bash /tests/test.sh' > "$WORK/logs/last-run-full.log" 2>&1
code=$?

# Mostrar solo el resumen de pytest y el veredicto final
grep -E '^(FAILED|PASSED|ERROR)|passed|failed|error' "$WORK/logs/last-run-full.log" | tail -25
echo "---"
if [ "$code" -eq 0 ]; then
  echo "VERDICT: RESOLVED (todos los tests requeridos pasan)"
else
  echo "VERDICT: NOT RESOLVED (exit $code)"
fi
exit $code

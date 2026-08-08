# Notas del instrumento (M0) — borrador vivo

Bitácora técnica del de-risk del instrumento de fork contrafáctico. Todo lo listado como **[código]** fue verificado leyendo la fuente (con path); **[experiencia]** fue verificado ejecutando; **[abierto]** está pendiente.

**Fecha de inicio**: 7/8/2026.

## Versiones pineadas

| Repo | SHA | Nota |
|---|---|---|
| `PrimeIntellect-ai/prime-agent` | `10fb172b9298b353b27cddf3cd44bf386c9ba5d0` | clonado 7/8/2026, commit del mismo día |
| `PrimeIntellect-ai/verifiers` | `0a4d872f021022310a08ec213a25f4efb4a0244a` | clon shallow 7/8/2026 |
| `PrimeIntellect-ai/research-environments` | `b10db7640be3051650eef759e6ed80ddcadae220` | via install del taskset swebench_verified_v1 |

## Receta de ejecución local (funciona) — [experiencia]

- prime-agent necesita Node ≥ 22.8. En esta máquina: Node 22 standalone en `~/.local/node22/` (bajado de nodejs.org, arm64; ni nvm ni Homebrew servían — nvm bloqueado por `prefix` en `~/.npmrc`, Homebrew universal elige mal la arquitectura para esbuild).
- Instalar: `npm ci` + `npm run build` en el clon (los paquetes internos se importan desde `dist/`; sin build, `ERR_MODULE_NOT_FOUND` en `@earendil-works/pi-agent-core`).
- Correr: `PATH="$HOME/.local/node22/bin:$PATH" <clon>/prime-agent.sh` — versión 0.7.1, preserva el cwd del caller.
- Azure: `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_BASE_URL=https://<resource>.openai.azure.com` + `--provider azure-openai-responses --model gpt-5.4`. Verificado end-to-end (respondió "pong").
- Aislamiento total de experimentos: `PRIME_AGENT_CODING_AGENT_DIR=<dir>` (config) + `--session-dir <dir>` (sesiones) + settings por proyecto en `<cwd>/.prime/agent/settings.json`.
- Modos headless: `-p/--print` (one-shot), `--mode json` (eventos como líneas JSON), `--mode rpc`. — [código: `packages/coding-agent/docs/usage.md`]

## Hallazgos para el fork — [código]

1. **`--fork` / `SessionManager.forkFrom()` NO copia la carpeta de artefactos de la sesión** (`session-manager.ts:2231`): copia el árbol de conversación (con nuevo ID, reescribe header, dropea `git_state`) y nada más. Con scope local, el `harness_state.json` vive en `<sessionArtifactDir>/harness/` (`refinement.ts:273`) → **la sesión forkeada nace con cuaderno vacío**. El instrumento debe copiar los artefactos a mano al forkear.
2. **`createBranchedSession(leafId)`** (SessionManager) extrae la rama hasta un entry arbitrario a un archivo nuevo → es el "rebobinado" exacto al punto del refine, mejor que `--fork` (que forkea el árbol entero).
3. **El registro de cada refinement es un entry `custom` con `customType: "prime-agent.refinement"`** en el JSONL de sesión (`agent-session.ts:7834`), con el resultado completo (ediciones aplicadas) como data. Es el ancla para localizar puntos de fork. Además queda `refinements.jsonl` (snapshots antes/después, rollback por ID) en el dir de harness state.
4. **Al abrir una sesión, el leaf = último entry del archivo** (`session-manager.ts:1328-1332`): truncar/extraer rama y reabrir posiciona al agente donde queremos.
5. **Auto-refine configurable al extremo**: `autoRefine.turnInterval` mínimo 1, `cooldownMs` mínimo 0 (`settings-manager.ts:835`, clamps `Math.max(1,...)` / `Math.max(0,...)`). Defaults: 25 turnos / 20 min / enabled / compact.

## Entornos SWE (verifiers) — [código + experiencia]

- Stack: `verifiers` v1 (taskset + harness + runtime) + tasksets en `research-environments`. Instalación del taskset: `uv pip install "git+...research-environments.git#subdirectory=environments/swe/swebench_verified_v1"`.
- Runtimes disponibles: `docker` (local), `subprocess`, `modal`, `prime` (hosted pago). — [código: `verifiers/v1/runtimes/`]
- Validación sin modelo: `uv run validate <taskset> -n 1 --runtime.type docker` (gold: parche dorado debe pasar tests; setup: sin parche deben fallar).
- **`push = true` por defecto en `eval`**: sube corridas a la plataforma de Prime. Usar siempre `--no-push`.
- Cada tarea SWE-bench Verified: imagen Docker pública prebuilt (`swebench/sweb.eval.*`), repo en `/testbed` (workdir), verifier corre dentro del contenedor. — [código: taskset.py de swebench_verified_v1]
- **No existe harness de prime-agent en verifiers**: los harnesses `pi` y `rlm` son otra cosa (`rlm` instala un binario aparte de `PrimeIntellect-ai/rlm-harness`, sin Continual Harness). El pegamento prime-agent↔tarea es nuestro. Opciones: (A) harness custom de verifiers para prime-agent; (C) correr prime-agent dentro del contenedor de la tarea a mano. Para M0 vamos por C.
- El harness de verifiers corre DENTRO del runtime y el tráfico de modelo pasa por un endpoint de intercepción (`endpoint`, `secret`, `ctx.model`) — relevante para trazas y swap de modelos si algún día usamos la opción A. — [código: `docs/v1/harnesses.md`]

## Hallazgos de la ronda 2 (7/8 por la noche) — [experiencia]

6. **La carpeta de artefactos va por ID interno, no por nombre de archivo**: `getSessionArtifactPath = dirname(sessionDir)/session-artifacts/<sessionId>` (`session-manager.ts:346`), y **el `id` del header JSONL puede no coincidir con el nombre del archivo .jsonl**. Regla del instrumento: leer siempre el header.
7. **prime-agent serializa el estado del kernel IPython**: `session-artifacts/<id>/kernel-state.dill` + `kernel-state.json`. La pata "memoria de Python" del estado del mundo la maneja el propio prime-agent; nos queda la pata filesystem.
8. **El pipeline de refine funciona headless**: `--resume <jsonl> -p "/refine"` corre el refiner real sobre la sesión retomada (respondió "Refined continual harness state: 0 edits applied"), crea `harness/harness_state.json` en los artefactos y deja el entry `custom` `prime-agent.refinement` en el JSONL. **Retomar + refinar a pedido, sin interfaz: confirmado.**
9. **El auto-refine en `-p` corre pero el gate filtra**: en la tarea trivial de vocales (5 turnos, turnInterval=1, cooldown=0) hubo 0 refinements; el contador se incrementa en cada turno no-error (`agent-session.ts:3510`) y en modos print/json/rpc el refine va "serializado" (`main.ts:661-665`), así que la maquinaria estaba activa — la explicación consistente es el gate diciendo `shouldRefine: false` sobre contenido sin jugo (coherente con que el `/refine` explícito aplicó 0 ediciones). Para el instrumento: **disparo determinista con `/refine` > esperar al trigger automático.**

## Diseño del mundo para la corrida SWE (M0) — [experiencia]

- Cerebro en el host (sesión JSONL + artefactos + harness state, todo forkeable como archivos); mundo en contenedor con el repo **bind-mounteado desde el host** (`experiments/m0-astropy/testbed` ↔ `/testbed`). Snapshot del mundo = copiar el dir del host.
- Verificación con contenedor **efímero** por corrida (`run_tests.sh`): monta testbed + tests oficiales + logs, corre `test.sh` de Harbor, deja reward en `logs/verifier/reward.txt`. El agente solo ve el resumen.
- **Anti-contaminación**: `tests/config.json` de Harbor contiene el parche dorado; jamás montarlo en el contenedor del agente ni dejarlo legible. El contenedor persistente del agente (`m0-astropy`) solo monta el testbed.
- Verificado: el env del contenedor importa el astropy del testbed montado (editable install) → ediciones en host visibles adentro al instante.

## Hallazgos de la ronda 3 — el rebobinado completo — [experiencia]

10. **Fork + resume: FUNCIONA.** `tools/fork_session.mjs` extrae la rama hasta un entry arbitrario (caminata id/parentId), genera id nuevo, copia artefactos al id nuevo. prime-agent retomó la sesión extraída headless y contestó correcto desde la historia previa al corte. El corazón del instrumento está demostrado.
11. **Cambio de modelo en la continuación: FUNCIONA.** La sesión iniciada con gpt-5.4 continuó con `--model gpt-5.1-codex-mini` (warning benigno "not found for provider... using custom model id"). El embudo chico→grande es viable.
12. **Deployments disponibles en el recurso Azure usado**: gpt-5.4, gpt-5-chat/5.2-chat/5.3-chat, gpt-4.1, **gpt-5.1-codex-mini** (candidato a continuaciones baratas), claude-opus-4-6, claude-sonnet-4-6, grok-4-1-fast-reasoning, DeepSeek-V3.2, text-embedding-3-small. Ojo: los no-OpenAI (claude/grok/deepseek) pueden no hablar el Responses API del provider `azure-openai-responses` — a verificar si hacen falta.
13. Costo de arranque del mundo astropy: la PRIMERA corrida del verificador recompila las extensiones C de astropy bajo emulación (lento, >10 min) porque el testbed extraído+montado dispara `pip install -e` completo; los .so quedan en el árbol montado → corridas siguientes deberían ser rápidas. El contenedor persistente (`m0-astropy`) NO necesita install: la imagen ya trae el editable install apuntando a /testbed (por eso `import astropy` fue instantáneo). Chequeos rápidos del agente → contenedor persistente; veredicto oficial → `run_tests.sh`.

## Ronda 4 — la corrida real y el primer experimento contrafáctico (7-8/8) — [experiencia]

**Corrida principal** (astropy__astropy-12907, gpt-5.4, autoRefine turnInterval=1/cooldown=0, headless):
- RESOLVED oficial (reward=1). El parche del agente = exactamente el dorado (`cright[...] = right` en `_cstack`), derivado por inspección de código (el config.json con la solución nunca estuvo montado en su contenedor).
- 14 turnos, 3 refinements reales, ~39k/2k tokens, **$0.15**.
- Secuencia de refinements: (1) memoria "hipótesis del bug en _cstack" [pre-fix], (2) memoria "fix aplicado" [post-fix], (3) cierre. Snapshots del mundo (`snapshots/ref1`, `ref2`) tomados en vivo al detectar cada refinement (monitor sobre el JSONL).

**Experimento fork con/sin nota** (fork en ref1: mundo virgen + hipótesis recién anotada; corte en el último entry pre-snapshot; 2 ramas × k=2, intercaladas, mundo reseteado con rsync antes de cada una; continuación con el mismo modelo):

| rama | nota | reward | segundos | turnos nuevos |
|---|---|---|---|---|
| A1 | con | 1 | 877 | 9 |
| A2 | con | 1 | 820 | 9 |
| B1 | sin | 1 | 892 | 10 |
| B2 | sin | 1 | 806 | 9 |

- **Δ ≈ 0**: las 4 resolvieron, mismos turnos y tiempos. Interpretación: la hipótesis vivía también en la conversación heredada → borrar la nota no removió información. Es el caso "la nota cristalizó algo ya sabido → valor bajo" de BACKGROUND §5, ahora con dato empírico.
- **Lección de diseño para M2**: el valor de una nota debería aparecer donde el contexto se degrada — forks post-compactación, horizontes largos, scope global entre sesiones. La selección del punto de fork es una variable del estudio, no un detalle.
- Costo del experimento completo: ~$0.60. Por continuación: ~$0.12-0.17 y ~14 min (dominados por el verificador bajo emulación; ver mejora pendiente de Docker/Rosetta y VM Linux).

## Veredicto de M0

**VIABLE TAL CUAL.** El flujo completo — sesión headless con auto-refine, snapshot del mundo por refinement, fork quirúrgico con variante de harness, continuación (incluso con otro modelo), outcome oficial — funciona sin modificar prime-agent. No hace falta fork del repo upstream. Los componentes nuestros: `tools/fork_session.mjs`, `run_tests.sh`, `run_continuations.sh`, snapshots por rsync/cp.

Deuda técnica conocida para M1: aislación por rama (mundos independientes → paralelismo), snapshot de kernel-state por punto de refine (hoy: una foto al detectar el evento, con ~20s de skew), tests nativos (VM Linux x86 en Azure o Docker+Rosetta local), y automatizar todo en un comando (`fork-eval`).

## Ronda 5 — performance del verificador (8/8) — [experiencia]

Actualización Docker Desktop 4.16.2 → **4.85.0** (engine 29.6.2), con Apple Virtualization + Rosetta (defaults en 4.85 para Apple Silicon).

- Trámite: la copia manual del .app necesitó relanzar vía `open -a Docker` y **resetear los settings** (`settings.json`/`settings-store.json` de 4.16 hacían crashear el backend: `panic ... DisableHardwareAcceleration`; respaldados en `_backup-pre-update/`). El primer arranque pide aceptar licencia en pantalla.
- **Ejecución de pytest: 2.26s → 0.30s (~8× más rápido)** — Rosetta cumple.
- **Pero el wall-clock del verificador solo bajó de ~4min a 2m40s**, porque `test.sh` de Harbor corre `pip install -e .[test]` en cada invocación: ~2.5 min resolviendo dependencias contra PyPI. **El cuello de botella NO es la emulación, es el setup de pip.**
- Costo único post-actualización: 70 min (re-pull de la imagen de 2.69GB porque el update resetea el disco de la VM + recompilación completa de las extensiones C de astropy). No se repite.
- **Implicación para M1**: la palanca grande no es CPU sino evitar el re-setup. Candidatos: `docker commit` de la imagen ya instalada (verificación ~segundos), o correr el verificador nativo en VM Linux x86. Medir antes de asumir cuál rinde más.

## Preguntas abiertas de M0 — [abierto]

- ¿El refiner produce ediciones reales sobre una tarea con contenido (la corrida astropy)? ¿Cuántas, de qué tipo?
- Variante `--harness without` (rollback del refine) sin probar: necesita un refinement con ediciones y su `refinements.jsonl`.
- **Consistencia del kernel-state en forks tardíos**: `kernel-state.dill` es UNA foto (la última), no una por turno. Forkear a un punto anterior con un kernel posterior es inconsistente. Mitigación M0: forkear al último refine de la corrida (foto coherente). Para M1: snapshot por punto de refine durante la corrida (mirando crecer el JSONL).
- Costo/latencia por continuación (para presupuestar M2).
- Pendiente menor: por qué el nombre del archivo .jsonl difiere del id del header (no bloquea; el instrumento lee el header).

## Decisiones de M0

- Consumimos el taskset de verifiers pero (por ahora) NO su orquestación de harness: prime-agent corre contra el workspace de la tarea directamente; los tests de la tarea dan el outcome.

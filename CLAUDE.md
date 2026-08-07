# CLAUDE.md — harness-refinement

Proyecto de investigación: medir si el auto-refinement de harnesses de agentes (Prime Agent y su "Continual Harness") aporta valor causal, con el **fork contrafáctico** como instrumento, sobre tareas SWE verificadas. Que las ediciones mejoren algo es la hipótesis a auditar, no el punto de partida.

## Lectura obligatoria al arrancar una sesión

1. **[BACKGROUND.md](BACKGROUND.md)** — todo el contexto conceptual, verificaciones y decisiones tomadas. Es el documento fundante: **no se edita** salvo pedido explícito del usuario (p. ej. cuando salga el reporte técnico de Prime).
2. **[ROADMAP.md](ROADMAP.md)** — milestones, criterios de cierre, decisiones pendientes. Documento vivo: se actualiza al cerrar trabajo.

## Regla epistémica de la casa

Todo claim sobre Prime Agent / ARC / VISTA se etiqueta en uno de tres niveles: **verificado en código** (con path del archivo), **verificado en fuente publicada** (con la fuente), o **reconstrucción** (inferencia, marcada como tal). Leer el código antes que el marketing. Desconfiar de "self-evolution" hasta ver qué archivo se escribe y quién lo lee.

## prime-agent: objeto de estudio, no producto

- Vive en `../prime-agent/` (clon de `PrimeIntellect-ai/prime-agent`), **pineado por SHA**. Read-only: no se modifica sin decisión explícita registrada en ROADMAP.
- Re-pinear el SHA es una decisión consciente que se anota, nunca un `git pull` de arrastre.
- Fork solo con evidencia de que hace falta (veredicto de M0).

## Experimentos

- Toda corrida significativa lleva manifest (hipótesis, params, **SHA de este repo y de prime-agent**, modelo, costos, métricas, conclusión) — template en el skill `dev-workflow` (experiment-manifest).
- Artefactos en `experiments/`, notas de instrumentación en `docs/`.
- Al evaluar el refiner, siempre tres brazos: real / placebo / sin-refine. Las señales observacionales de JSONL son supervisión débil, nunca sustituto de causalidad.

## Estado

- **7/8/2026**: solo documentos, sin GitHub aún (la watchlist de ROADMAP migra a issues cuando exista). Próximo trabajo: M0 (de-risk del instrumento).
- Idioma de trabajo: español. Workflow estándar: skill `dev-workflow` (presentar antes de commitear, etc.).

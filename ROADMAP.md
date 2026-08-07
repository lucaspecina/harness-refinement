# harness-refinement — Roadmap

Capa operativa sobre [BACKGROUND.md](BACKGROUND.md). El background dice qué se sabe y por qué importa; este documento dice qué se hace, en qué orden y con qué criterio de cierre. Es un documento vivo: los milestones posteriores a M0 son borradores que se re-dimensionan con lo que M0 y M2 descubran.

**Estado al 7/8/2026**: repo local, solo documentos. Sin GitHub todavía. prime-agent aún no clonado junto al repo.

---

## Estructura de repos

- `harness-refinement/` (este repo): documentos, instrumento de medición, experimentos, análisis. El cerebro del proyecto.
- `../prime-agent/`: clon del upstream `PrimeIntellect-ai/prime-agent`, **pineado por SHA** y tratado como read-only. Es el objeto de estudio, no el producto. Todo manifest de experimento registra el SHA de ambos repos.
- **Fork de prime-agent: solo con evidencia.** Si M0 demuestra que hace falta modificarlo (hooks de fork, headless roto, etc.), ahí se crea el fork con parches con nombre y motivo. No antes.

---

## M0 — De-risk del instrumento (fork manual end-to-end)

**Contexto.** Todo el proyecto se apoya en poder clonar una sesión en el punto de un refine y continuarla headless con el harness editado o no. Está verificado en código que el *formato* lo permite (árbol por punteros, rollback por ID); nadie verificó el *flujo* como experiencia. M0 es demostrar que el instrumento puede existir, a mano, sin métricas.

**Alcance.**
1. Clonar prime-agent en `../prime-agent`, pinear SHA, instalar, correr una sesión interactiva trivial (sanity check).
2. Conseguir **una** tarea SWE de los entornos verificados de Prime Intellect corriendo localmente. Descubrir cómo se consumen (CLI, hub, librería, sandbox).
3. Correr prime-agent headless sobre esa tarea con auto-refine activado (bajar la cadencia si hace falta para forzar refines). Capturar sesión JSONL, `harness_state.json`, `refinements.jsonl`.
4. Forkear a mano en un punto de refine: una rama con la edición aplicada, otra con la edición revertida (rollback por ID). Dos continuaciones por rama, hasta el próximo checkpoint verificable (corrida de tests).
5. Documentar todo lo descubierto en `docs/instrument-notes.md`: qué funcionó, qué peleó, costos y tiempos reales por continuación.

**Preguntas que M0 tiene que contestar** (esto es lo que se compra con el milestone):
- **La pregunta del estado del mundo.** La conversación vive en el JSONL, pero el filesystem del repo target y el estado del kernel IPython **no**. Forkear en el turno *t* exige restaurar el mundo del turno *t*: ¿alcanza git + snapshot de untracked del workspace? ¿el kernel se re-hidrata o se pierde? ¿cuánto de eso ya lo maneja prime-agent y cuánto hay que construir? Esta es la pregunta técnica central del proyecto y el background no la tiene resuelta.
- ¿El modo headless/no-interactivo existe y aguanta una tarea completa sin daemon interactivo?
- ¿Se puede continuar una sesión forkeada con un **modelo distinto** al que la empezó? (Necesario para el embudo chico→grande.)
- Costo y latencia reales de una continuación (insumo para presupuestar M2/M3).
- ¿Hace falta tocar prime-agent? → decisión de fork, con evidencia.

**Criterio de cierre.** Dos continuaciones headless desde el mismo punto de fork con estados de harness distintos, corriendo hasta un checkpoint verificable, con logs completos; y `docs/instrument-notes.md` con veredicto explícito: *viable tal cual / viable con parches (→ fork) / hay que rediseñar el instrumento*.

---

## M1 — Instrumento: forker automatizado

**Contexto.** Convertir la receta manual de M0 en una herramienta de un comando.

**Alcance.** `fork-eval --session S --refine R --k K --horizon checkpoint` → 2 ramas × k continuaciones, outcome medido por los tests del entorno (graduado, no binario), y un manifest por corrida (SHAs de ambos repos, modelo, config, seeds si los hay, costos, resultados). Layout estable de artefactos en `experiments/`.

**Criterio de cierre.** Un refinement real medido end-to-end con un solo comando, reproducible desde su manifest por otra sesión.

---

## M2 — Piloto: varianza, horizonte y calibración

**Contexto.** La varianza puede comerse efectos chicos (riesgo aceptado en BACKGROUND §8). Antes de escalar, dimensionar con números.

**Alcance.** Sobre pocas tareas (~5) y ~20–30 refinements:
- **Varianza base**: k grande de continuaciones *idénticas* (mismo harness) → cuánto ruido hay entre continuaciones; de ahí, curva de poder estadístico (qué k separa qué tamaño de efecto).
- **Horizonte truncado**: comparar Δ a checkpoint próximo vs. horizonte más largo en un subconjunto; dimensionar el sesgo asumido.
- **Calibración del embudo**: Δ con modelo abierto barato vs. Δ con modelo grande sobre los mismos ~30 refinements, separando notas de *hechos del entorno* vs. *parches de comportamiento* (la hipótesis es que el chico es evaluador legítimo solo para las primeras).

**Criterio de cierre.** Números para k, horizonte y modelo de continuación; presupuesto estimado de M3; decisión go/no-go/redimensionar.

---

## M3 — Post-mortem de tres brazos

**Contexto.** La pregunta headline: ¿el refinement aporta valor medible? Diseño sin rama perdedora (BACKGROUND §6).

**Alcance.** Real vs. **placebo** (ediciones aleatorias verosímiles, costo en tokens similar) vs. **sin refine**, sobre M tareas SWE (M sale de M2). Análisis por edición y por tipo de nota. En paralelo, el track barato: señales observacionales débiles (nota borrada/corregida después, uso en thinking posterior, cristalización de algo ya hipotetizado) extraídas de los JSONL y correlacionadas contra el Δ dorado del fork — para saber cuánto predicen y si sirven como supervisión ruidosa en M4.

**Criterio de cierre.** Distribución de Δ con intervalos por brazo; respuesta publicable (en cualquier dirección: aporta / no aporta / daña); writeup con la curva de poder como resultado propio.

---

## M4+ — Condicionales (solo si M3 muestra cola positiva)

En orden, cada uno condicionado al anterior; ideas desarrolladas en BACKGROUND §7:

1. **best-of-N** de ediciones candidatas con el verificador contrafáctico como juez → mejora inmediata sin gradientes + fabrica pares de preferencia.
2. **Crítico barato** `(contexto, edición) → Δ̂` destilado de las etiquetas doradas + señales débiles como supervisión ruidosa; validado prediciendo Δ de forks no vistos.
3. Preferencias sobre los pares; **RL online al final solo si queda jugo** — con la sospecha explícita de que 1+2 capturen casi todo el valor.

Guardas no negociables (decididas en BACKGROUND §8): no-op permitido y premiable, alquiler por token de cada nota, condicionar en el modelo base, y **verificador anti-trampa antes que cualquier optimizador**.

---

## Watchlist

- **Reporte técnico de Prime** (prometido "pronto" al 7/8/2026): al salir, actualizar BACKGROUND §9 — puede cerrar reconstrucciones (config de ARC, scope, cadencias). Revisar si cambia M0/M1.
- Movimiento del upstream `prime-agent`: re-pinear SHA siempre como decisión consciente, nunca de arrastre.
- GEPA y familia (evolución de prompts sin gradientes): la vara que cualquier refiner entrenado de M4 tiene que superar.
- Cuando exista el repo GitHub: esta watchlist migra a issues.

## Decisiones pendientes

| Decisión | Cuándo | Insumo |
|---|---|---|
| Proveedor y presupuesto para continuaciones (Azure vs. API directa; qué modelo abierto) | M0 → M2 | costos reales de M0 |
| Crear GitHub repo + Project v2 + skill de tracking | cuando el roadmap esté firme | esta conversación |
| Fork de prime-agent | cierre de M0 | veredicto de `instrument-notes.md` |

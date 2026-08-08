# harness-refinement

**¿Las notas que un agente se escribe a sí mismo lo hacen mejor?** Nadie lo midió. Este repo construye el instrumento para hacerlo.

## El problema

[Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) trae un "Continual Harness": un refiner que lee la trayectoria del agente y edita un archivo de notas (`harness_state.json`) que se reinyecta en el system prompt. La promesa es auto-mejora. Pero el sistema es **a lazo abierto respecto del outcome**: ninguna nota se evalúa nunca contra un resultado. Si el refiner escribiera ediciones aleatorias y el agente igual resolviera la tarea, nada lo distinguiría.

No hay ablations con/sin refine, ni análisis por edición, ni brazo placebo. La pregunta "¿esto sirve?" está sin responder — no solo para Prime Agent, sino para toda la familia de agentes que escriben memoria (Reflexion, ExpeL, Voyager, AWM...).

## El instrumento: el fork contrafáctico

El dato que falta —*qué hubiera pasado sin esa nota*— no está en ningún log, porque la historia ocurrió una vez. Hay que fabricarlo:

1. Correr el agente en una tarea con verificador objetivo (SWE-bench Verified).
2. Congelar la sesión **y el mundo** en el instante exacto de un refinement.
3. Bifurcar: una rama con la edición, otra sin ella. Todo lo demás idéntico.
4. Correr *k* continuaciones por rama hasta el próximo checkpoint verificable.
5. Medir Δ y su varianza.

El estudio **no tiene rama perdedora**: Δ ≈ 0 es un resultado negativo fuerte e inédito; cola positiva habilita best-of-N sobre ediciones candidatas; cola negativa ("refinar daña") es más fuerte todavía.

## Estado

**M0 cerrado (8/8/2026): el instrumento funciona, sin modificar prime-agent.**

Primera medición: prime-agent (gpt-5.4) resolvió `astropy__astropy-12907` en 14 turnos y $0.15, escribiendo 3 refinements. Fork en el primero (una hipótesis sobre la causa del bug), 2 ramas × k=2 → las 4 resolvieron, mismos turnos y tiempos. **Δ ≈ 0**, con explicación mecanicista: la hipótesis también vivía en la conversación heredada, así que borrar la nota no removió información.

De ahí el aprendizaje que se lleva el piloto: **el punto de fork es una variable del estudio**. El valor de una nota debería medirse donde el contexto se degrada (post-compactación, horizontes largos, entre sesiones), no donde es redundante con lo que el agente acaba de decir.

## Documentos

| Archivo | Qué es |
|---|---|
| [BACKGROUND.md](BACKGROUND.md) | El contexto completo: qué es el Continual Harness (verificado leyendo su código), el contrapunto de VISTA, el diagnóstico de lazo abierto, el mapa de trabajo previo. Documento fundante. |
| [ROADMAP.md](ROADMAP.md) | Milestones M0–M4 con criterios de cierre. Vivo. |
| [docs/instrument-notes.md](docs/instrument-notes.md) | Bitácora técnica: cómo se corre todo, qué se rompió, qué se descubrió leyendo el código. |
| [experiments/](experiments/) | Corridas con manifest (hipótesis, SHAs, config, costos, conclusión) y trayectorias completas. |
| [tools/fork_session.mjs](tools/fork_session.mjs) | El forker: corta una sesión en un entry arbitrario y arma la rama con su estado de harness. |

## Regla de la casa

Todo claim se etiqueta: **verificado en código** (con path), **verificado en fuente publicada** (con la fuente), o **reconstrucción** (marcada como tal). Leer el código antes que el marketing.

Investigación en curso, en español. Sin afiliación con Prime Intellect.

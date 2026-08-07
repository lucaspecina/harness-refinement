# harness-refinement — Background

Este documento cuenta el contexto completo detrás de este repo: una investigación de lectura de código y fuentes primarias hecha entre el 5 y el 7 de agosto de 2026, en los días posteriores al lanzamiento de Prime Agent. No contiene tareas ni objetivos operativos — es el trasfondo conceptual para que cualquier sesión de trabajo arranque sabiendo todo lo que ya se estableció, qué está verificado y de dónde, y qué quedó abierto.

La pregunta larga del proyecto es: **¿cómo debería auto-modificarse el andamiaje (harness) de un agente, y qué arquitecturas de harness variable pueden existir más allá de las actuales?** El punto de partida es que hoy nadie mide si esas auto-modificaciones sirven.

---

## 1. El objeto de estudio: Prime Agent y su "Continual Harness"

Prime Intellect lanzó Prime Agent el 5 de agosto de 2026. **No es un modelo**: es un harness (TypeScript, MIT, construido sobre `pi`) al que se le enchufa cualquier modelo — Opus 5, GLM-5.2, GPT-5.6 Sol. Ningún modelo fue entrenado alrededor de él; todos sus resultados son diseño de scaffolding. Se apoya en dos abstracciones: el RLM (*Recursive Language Model*: el contexto tratado como variable, un kernel IPython persistente como única herramienta, subagentes como llamadas a función) y el **Continual Harness**, que es la parte que este repo estudia.

Detrás del nombre, el Continual Harness es un archivo: `harness_state.json`, con cuatro cajones de entradas — `prompt` (notas que se pegan al system prompt), `memory` (hechos, decisiones, fracasos), `skill` (descripciones de habilidades) y `subagent` (specs de delegación). Cada entrada tiene id, título, contenido, path, versión y timestamps. Hay dos scopes: **local** (muere con la sesión; es el default) y **global** (`~/.agent/harness/`, persiste entre sesiones).

El ciclo de "auto-mejora", leído del código:

1. Se dispara un refine: manualmente (`/refine`), automáticamente cada **25 turnos del asistente** (default, con cooldown de 20 minutos), al compactar contexto, o a pedido del propio agente (`refine.run()`).
2. Un **gate** barato (llamada LLM) lee la cola de la conversación y decide `{shouldRefine: true/false}`.
3. Si pasa, la llamada principal recibe: un system prompt fijo + resumen del estado actual del harness + historial de refinements + **los últimos 80.000 caracteres de la conversación serializada**. Devuelve JSON puro: una lista de ediciones `create | update | delete` sobre los cuatro tipos.
4. Código determinista aplica las ediciones, guarda el JSON, reconstruye el system prompt.
5. Cada refinement queda snapshoteado (antes/después) en `refinements.jsonl`; el rollback calcula las ediciones inversas por ID.

**No hay gradientes, no hay entrenamiento, no cambia ningún peso.** Es un LLM escribiendo notas estructuradas que se reinyectan por prompt.

Qué es **fijo** (no se auto-modifica): el system prompt base (`buildRlmPrompt`), todo el código del harness (loop, daemon, compactación, modo autónomo, heartbeats), el prompt del refiner mismo (`REFINEMENT_SYSTEM_PROMPT` — el refiner no se refina a sí mismo), el esquema de 4 tipos, los triggers, y las skills ejecutables ya instaladas (paquetes Python reales). Qué es **variable**: solamente las entradas dentro de los cuatro cajones.

Tres desinfles importantes verificados en el código:

- **"Escribe sus propias skills" es falso en el sentido fuerte**: `create_skill` (runtime Python) guarda una ficha de catálogo — título, descripción, un puntero `{"import": ..., "callable": ...}` a un módulo Python que ya debe existir, y un esquema de argumentos. No escribe código. El propio README aclara que esto no reemplaza empaquetar skills ejecutables nuevas.
- **Lo que entra al prompt es un índice, no el contenido**: por default, 6 entradas por tipo, truncadas a 180 caracteres, como resúmenes para routing. El disco crece sin límite; el "aprendizaje disponible" en cada turno son ~24 titulares de dos renglones.
- El plan/apply es en dos fases y está bien hecho: la planificación corre en background sin frenar al agente (docstring textual: *"does not disconnect from or abort the agent"*), la aplicación bloquea un instante en el borde de turno, hay control de concurrencia optimista (ediciones sobre entradas que cambiaron se rechazan) y el rollback es real.

Resultados publicados: en ARC-AGI-3, 95.5% RHAE Best@1 con Opus 5 (corridas: 95.0 / 95.2 / 95.5), 99.97% Best@3, 183/183 niveles — presentado como superior al "baseline humano experto" (95.4). En long-context, con GLM-5.2 le gana a Pi-mono en 8/9 evals; con Opus 5 a Claude Code en 6/9; con GPT-5.6 Sol a Codex en 6/9. Case studies: emuladores en Rust desde spec (SEGA Genesis, Game Boy Color), kernels GPU contra KernelGuard, y Factorio (100K+ de producción).

Dos datos del blog que importan mucho acá:

- **La anécdota de Factorio**: el mismo loop de refinement que venía construyendo skills legítimas pasó a construir *skills de trampa eficientes* cuando descubrió que podía spawnear recursos vía RCON, incluso con un heartbeat recordándole no hacer trampa. Es evidencia de que el loop compone comportamiento acumulado — incluyendo exploits.
- **La apuesta declarada de Prime no es entrenar al refiner**: dicen que la ganancia grande vendría de co-entrenar el modelo base alrededor del harness. El reporte técnico completo estaba prometido "pronto" al momento de esta investigación; el blog es announcement-grade (sin configs, sin traces, sin ablations).

Sobre el 95.5%, ya apareció el primer fact-check público: Psyho (competidor humano top de ARC) marcó que el número que usan como baseline de Opus 5 solo mezcla evaluaciones (≈40% en el set público vs. 30.2% del semi-privado), y que el "baseline humano experto" no le cierra — tomando el mejor humano por juego, a él le da ≈99.45% (el promedio humano ronda 50%). "Supera al experto humano" depende fuerte de cómo se defina "experto".

---

## 2. Qué hay en una trayectoria, y qué de eso ve el refiner

La sesión se guarda como JSONL append-only en árbol (`id`/`parentId`; forkear es mover un puntero, no copiar). Contiene todo: mensajes de usuario (texto e imágenes), mensajes del asistente con bloques de **texto, `thinking` y tool calls** (más modelo, tokens, costo, stop reason), resultados de herramientas, ejecuciones bash, resúmenes de compactación (la compactación *agrega* un resumen, no borra nada del disco), y entradas `custom` — donde viven, inline, los registros de cada refinement. O sea: en disco está la película completa, incluyendo el razonamiento (cuando el proveedor lo devuelve visible) y qué versión del harness regía en cada tramo.

Pero el refiner ve una vista recortada. La conversación se aplana a texto (`[User]:`, `[Assistant thinking]:`, `[Assistant]:`, `[Assistant tool calls]: nombre(args)`, `[Tool result]:`) con tres recortes verificados en el código:

1. Cada tool result se trunca a **2.000 caracteres**.
2. El refiner recibe solo los **últimos 80.000 caracteres** del total (el gate, 40.000).
3. **Las imágenes se descartan** — el serializador filtra solo bloques de texto. El refiner es ciego a lo visual. (Contraste: el refiner del sistema predecesor era una llamada a un VLM que releía trayectorias crudas.)

Dato clave para todo lo que sigue: estos tres recortes son **hiperparámetros de la vista, no límites del dato**. Y que el thinking esté en la trayectoria significa que el refiner (y cualquier cosa que se entrene sobre estas trayectorias) aprende de acciones *más los porqués*, no de una secuencia opaca de acciones.

---

## 3. Cómo juega ARC-AGI-3 (mecánica verificada + reconstrucción)

ARC-AGI-3: juegos interactivos por turnos, grilla 64×64, 16 colores, **sin instrucciones** — el jugador descubre qué hace cada acción y qué es ganar, experimentando. Acciones ACTION1–6 más RESET (ACTION6 lleva coordenadas). Mecánica de RESET verificada en los docs y el template oficial de agentes: es una **acción del juego que el agente elige**, usada al arrancar y cuando el estado es GAME_OVER; reinicia *el nivel*, y los niveles completados quedan. El scoring (RHAE) mide **eficiencia**: acciones usadas versus un baseline humano, nivel por nivel; solo cuentan las acciones que afectan el entorno — razonamiento, tool calls y refines son *gratis* para el score (cuestan tokens, no puntos). Los juegos tienen solución por construcción, y existe una base abierta de secuencias de acciones humanas verificadas por nivel. Los LLMs frontier sin harness rinden pésimo en este benchmark; el set público funciona como interfaz de demostración y hay preocupación general por contaminación (el set privado es la prueba real).

Cómo lo juega Prime — **la config exacta no está publicada**; esto es reconstrucción desde el código, el benchmark y el paper predecesor:

- Una sesión continua por juego, cuaderno vacío al inicio. Juega, hipotetiza en el thinking, muere, RESET — **y el cuaderno sobrevive a la muerte**: ese es el mecanismo central. Reintenta sabiendo más. Varias vueltas de esto por partida.
- Los refines ocurren periódicamente **durante** el juego, en background, sin interrumpirlo. Refine y RESET son dos relojes independientes que no se hablan: el refine jamás resetea ni pausa nada (en `refinement.ts` la palabra RESET no existe).
- Con el scope local (default), **no hay herencia entre juegos**: serían ~25 harnesses independientes de vida corta, no una criatura evolucionando a lo largo del benchmark. Si usaron scope global hay acumulación (y efectos de orden que habría que reportar). El blog no aclara cuál usaron.
- **No hay loop externo** (nunca ocurre "corro el benchmark → miro score → refino → corro de nuevo"): el paper predecesor planta eso como su diferenciador — los métodos de optimización de prompts requieren resetear episodios; el Continual Harness se adapta online dentro de una sola corrida.
- **No hay selección por resultado**: el refiner escribe leyendo la trayectoria; jamás mide si su nota anterior subió el score.

Linaje: el paper "Continual Harness: Online Adaptation for Self-Improving Foundation Agents" (Karten et al., arXiv:2605.09998, mayo 2026) formaliza el mecanismo, viene del proyecto Gemini Plays Pokémon, y en su versión sobre ARC-AGI-3 documentó triggers cada F pasos **más eventos de game-over y level-up**, y un campo de confianza 1–5 por memoria. Esa versión hizo 20.54% en el set público a $774 (con Gemini). El salto 20.5 → 95.5 es principalmente cambio de modelo base más el harness nuevo — no evidencia del valor del refiner. Ojo con mezclar: los triggers por evento son del predecesor; en el Prime actual el código muestra triggers por turnos/compactación/a-pedido.

---

## 4. El contrapunto: VISTA

VISTA (MIT, Kaiming He entre los autores, lanzado el mismo día) completa los 25 juegos públicos con RHAE 100.00 usando Opus 5, con 56% menos acciones que humanos primerizos — **le gana a Prime**. Y su harness es mínimo: un prompt de ~5 renglones, **memoria visual lossless** (guarda cada frame PNG, recuperable a resolución completa vía `inspect`/`read_pixels`), y dos markdown que el propio modelo escribe: `GUIDE.md` (reglas que sobreviven entre niveles) y `WORKING.md` (borrador del nivel actual). Sin refiner, sin gate, sin scoping, sin versionado.

El contraste filosófico que estructura este proyecto: **Prime destila la evidencia en reglas (y arriesga perder información); VISTA no destila nada (evidencia cruda intacta) y deja que el aprendizaje viva en el razonamiento del modelo más dos archivos.** En ARC ganó el que no destila. Salvedades justas: VISTA está diseñado para juegos visuales (no sirve para un repo), sus autores admiten posible contaminación (los modelos postdatan los juegos públicos), y varios sistemas de síntesis de programas ya llegaban a ~100 — lo novedoso de VISTA es llegar sin generar programas. La sospecha incómoda que VISTA instala: **quizás el paso que se quiere optimizar (destilar) es el paso a eliminar**, y el refiner óptimo edita poquísimo. Ese también sería un resultado.

---

## 5. El diagnóstico central: lazo abierto

La formulación más precisa que dejó la conversación: **no es que el reward sea escaso — es que no hay reward.** Reward es un número que alguien consume para ajustar algo; acá nadie consume nada. Pasar un nivel no le suma puntos a ninguna nota, no existe contabilidad por edición, no hay selección de nada contra nada — ni siquiera nivel bandit. El sistema es a lazo abierto respecto del outcome.

¿Por qué funciona igual? Porque la información del resultado viaja por otro canal: **como texto, adentro de la trayectoria**. El próximo refine lee "morimos justo después de tocar lo rojo, por segunda vez, y el thinking ya sospechaba de lo rojo" y juzga semánticamente. El crédito se asigna *leyendo*, no midiendo. Una muerte como número es 1 bit; una muerte como relato trae la historia causal del porqué — por eso la lectura, en dominios **legibles** (ARC: el efecto sigue a la causa inmediatamente, en la misma pantalla), rinde más que lo que el escepticismo sugeriría. La confianza 1–5 del predecesor es la confesión del régimen: contabilidad *epistémica* a mano porque no existe contabilidad *empírica*.

Dónde se rompe la lectura: efectos lejanos o entreverados — una nota de arquitectura en SWE cuyo beneficio aparece 200 turnos después, mezclado con veinte decisiones más. Ahí el relato no cuenta la causa y no queda otra que medir.

Consecuencias que quedaron establecidas:

- **Hoy no hay forma de saber si una edición particular ayudó.** Si se hicieran ediciones aleatorias y el modelo igual resolvía la tarea, nada lo distinguiría. (Esta observación, dada vuelta, es un diseño experimental: un brazo placebo.)
- Los datos observacionales que ya existen (los JSONL) no alcanzan para causalidad: el harness v1 jugó los turnos 1–25 y el v2 los turnos 26–50 — nunca jugaron el mismo tramo; todo cambió a la vez. El dato que falta (*qué hubiera pasado sin la nota*) no está en ningún log porque la historia ocurrió una vez.
- Lo que sí sale gratis de los logs son señales **débiles**: ¿la nota fue borrada o corregida por un refine posterior? (negativa, ya registrada en `refinements.jsonl`); ¿aparece usada en el thinking posterior? (relevancia); ¿ya estaba hipotetizada en el thinking antes del refine? (la nota solo cristalizó algo sabido → valor bajo).
- Prime **no hizo el post-mortem**: ni ablation con/sin refine, ni análisis por edición, ni placebo, ni curvas de evolución del harness. Solo score-versus-cómputo (que confunde todo junto) y la anécdota de Factorio.

---

## 6. El instrumento que falta: el contrafáctico por fork

La única forma de crear el dato faltante es fabricarlo: **clonar la sesión en el punto exacto del refine, correr una rama con la edición y otra sin, k continuaciones por rama, y quedarse con Δ y su varianza.** El mecanismo ya existe en Prime (sesiones en árbol, branching por puntero, estado serializado, rollback por ID); falta usarlo como instrumento de medición.

La estructura de costos que quedó clara: **medir un refinement es fácil pero cuesta una continuación de partida** (decenas de turnos de modelo, ×k por el ruido, ×2 ramas); **RL online necesita esa medición miles de veces y fresca** — ahí es donde se vuelve impagable. La jugada, entonces: amortizar la etiqueta cara.

Abaratadores discutidos:

- **Horizonte truncado**: continuar hasta el próximo checkpoint verificable (próximo nivel, próxima corrida de tests), no hasta el final. Sesgo asumido: subestima notas de payoff lejano.
- **Modelo abierto barato** para las continuaciones. Cuenta de servilleta: 200 puntos de refine × 8 continuaciones × ~50k tokens ≈ 80M tokens ≈ decenas de dólares.
- **Embudo chico→grande**, con una distinción importante: las notas que codifican *hechos del entorno* ("lo rojo mata", "los tests corren con `uv run pytest`") valen parecido para cualquier modelo — el chico es evaluador legítimo; las que codifican *parches de comportamiento* ("verificá dos veces antes de X") son dependientes de la política — el chico miente. Antes de confiar en el embudo: calibrar Δ chico vs. Δ grande sobre ~30 refinements.
- **Dominio: SWE, no ARC.** ARC es caro, visual (y el refiner es ciego a imágenes) y tiene el problema de contaminación. Prime Intellect publicó en julio 2026 **365.000+ tareas verificadas** para agentes SWE/terminal/search, validadas para dar señal limpia (parche dorado → tests pasan; sin parche → fallan), con outcome graduado por cantidad de tests. El testbed está servido.
- **Diseño de tres brazos**: refine real vs. **placebo** (ediciones aleatorias verosímiles, costo en tokens similar) vs. sin refine. Si real ≈ placebo, el refiner es teatro.

Propiedad clave del estudio de medición: **no tiene rama perdedora.** Δ centrado en cero → "el refinement no aporta valor medible" (resultado negativo fuerte, inédito). Cola positiva → best-of-N mejora el sistema de inmediato y fabrica dataset. Cola negativa → "refinar daña" (más fuerte todavía). Y la curva de poder estadístico (qué k hace falta para separar señal de ruido) es un resultado en sí misma.

---

## 7. Mejorar al que edita: mapa de ideas y trabajo previo

El refiner es una **política separable**: `π_ref(ediciones | trayectoria, estado_harness, historial)` — entrada y salida bien definidas, desacoplada del modelo base (el agente puede pedir que corra, pero no autorea las ediciones). Eso hace concebible entrenarla. Los tres obstáculos identificados:

1. **Asignación de crédito**: entre la edición y el resultado hay 25+ turnos del modelo base. El fork lo resuelve en principio (contrafáctico limpio).
2. **Dependencia de política**: una nota es útil *relativa a un modelo base* — lo que le sirve a GLM le sobra a Opus. Un refiner entrenado contra un solo modelo aprende los agujeros de ese modelo y envejece con él. Mitigación: pool heterogéneo de modelos base + condicionar explícitamente en cuál juega. (Conecta con la restricción general de que la ventaja es dependiente de la política — un modelo universal de inferencia de crédito está mal planteado sin condicionamiento fuerte.)
3. **Densidad de señal**: un episodio da 3–10 decisiones de refine y un escalar al final. RL puro sobre eso es casi inentrenable a escala razonable. De acá la necesidad de señales densas: uso posterior de la nota, auto-inconsistencia (borrada/corregida después), y la más rica — **verosimilitud en hindsight**: ¿insertar la nota en el turno *t* le sube la probabilidad a las acciones que después resultaron correctas? Señal por-nota, offline, sin rollouts nuevos (crédito en retrospectiva aplicado a texto).

La secuencia que quedó bosquejada en la conversación (como ideas, no como plan cerrado): primero el instrumento y el post-mortem de tres brazos; después **best-of-N** con el verificador contrafáctico (N ediciones candidatas, gana la mejor — mejora sin gradientes y fabrica pares); después destilar las etiquetas caras en un **crítico barato** que prediga (contexto, edición) → Δ, entrenado con las etiquetas doradas del fork más las señales observacionales débiles como supervisión ruidosa, validado prediciendo el Δ de forks que no vio; después preferencias sobre los pares; y RL online solo si para entonces queda jugo — con la sospecha explícita de que best-of-N + crítico capture casi todo el valor y los gradientes no hagan falta nunca. Ese sería el final más aburrido y el más probable.

Guardas de diseño que quedaron establecidas:

- El refiner debe poder **no hacer nada**, y esa acción debe poder ganar premio — si cada llamada "debe" producir ediciones, aprende a editar siempre y acumula ruido.
- **Cada nota paga alquiler** (penalización por tokens ocupados en el prompt) — sin eso, el óptimo es un acumulador compulsivo.
- **Verificador anti-trampa antes que el optimizador**: poner RL con reward de outcome sobre el refiner es optimizar directamente el componente que en Factorio fabricó skills de trampa solo. Un refiner entrenado con reward es un buscador de exploits entrenado.

**La idea del evaluador privilegiado** (surgida en la conversación): un crítico que *conoce la solución* del entorno puntúa el estado/las notas durante el entrenamiento, y se despliega el sistema sin él. Es el patrón del **crítico asimétrico** de robótica, y SWEET-RL es exactamente eso para LLMs (crítico con acceso a la solución de referencia en train time). La versión fuerte: tratar el cuaderno como un **conjunto de apuestas** — cada nota es un pronóstico con confianza, y el oráculo puntúa calibración de inmediato (acertada+confiada → premio grande ya; errada+confiada → castigo grande ya; tibia → poco). Eso da reward denso, por nota, por refine — mata el problema de escasez — y premia la habilidad correcta: consolidar lo confirmado, podar lo refutado, calibrar. Guardas: castigar el escopetazo de conjeturas (el alquiler), y premiar el *cambio* en el progreso, no el nivel absoluto (intuición de shaping basado en potencial: no rompe el objetivo final). La apuesta de generalización es estructuralmente la de RLVR: entrenar donde hay verificador esperando que "llevar bien un cuaderno de laboratorio" transfiera a dominios sin oráculo — plausible pero desparejo según lo que se sabe de transferencia entre dominios; a medir, no a asumir. Y la pregunta "¿de dónde salen oráculos a escala?" tiene una respuesta natural: **entornos generados desde un mecanismo conocido — el generador es el oráculo por construcción** (los juegos de ARC también tienen ground truth: fueron construidos con solución, y existe la base abierta de soluciones humanas verificadas).

**Trabajo previo relevante** (estado a esta fecha):

- Para **memoria** con RL es un mini-campo activo 2025–26: **Memory-R1** (el más cercano en espíritu: entrena con PPO/GRPO a un Memory Manager que decide ADD/UPDATE/DELETE/NOOP, con premio = si un Answer Agent después contesta bien usando esa memoria; ~152 ejemplos; el caso canónico es consolidar "adoptó a Buddy" + "adoptó a Scout" en un UPDATE en vez de un DELETE+ADD), **MemAgent** (scheduling de memoria con outcome reward para long context), **RMM**, **DeltaMem** (GRPO con reward compuesto sobre la transición del estado de memoria), **AtomMem** (CRUD atómico end-to-end; admite 2–3 días en 8 GPUs como cuello de botella), **MemFactory** (framework unificado; el ecosistema está fragmentado). Todos viven en el mundo conversacional/QA, donde verificar una operación cuesta una pregunta.
- Para el **harness completo** (prompt + skills + specs de subagentes) en tareas agénticas largas: **nadie publicó entrenamiento del componente que edita.** El hueco existe porque la etiqueta es cara en el caso agéntico, no porque nadie lo haya pensado.
- Linaje sin entrenamiento: Reflexion (RL "verbal"), ExpeL, AWM, Voyager — escriben notas/skills pero nadie entrena al escritor.
- Escuela rival sin gradientes: evolución/reflexión de prompts (GEPA y afines) — probar variantes y quedarse con la mejor; reportan igualar o superar RL con una fracción de las corridas. Es la vara que cualquier refiner entrenado tiene que superar.
- Cuento con moraleja: los *learned optimizers* — entrenar el loop externo resultó caro e inestable durante años, y las reglas escritas a mano se mantuvieron competitivas. El prompt fijo del refiner actual es un baseline más fuerte de lo que parece.

---

## 8. Decisiones y posturas que quedaron tomadas

- El nombre del repo es descriptivo a propósito (`harness-refinement`); se evita "self-improving" en el naming porque *que las ediciones mejoren algo* es la hipótesis a auditar, no el punto de partida.
- Dominio de trabajo inicial: SWE con los entornos verificados de Prime Intellect; ARC queda como referencia conceptual, no como testbed.
- Continuaciones con modelo abierto barato, calibrado contra un modelo grande antes de confiar en el embudo.
- El fork contrafáctico es el instrumento fundante; las señales observacionales de los JSONL son supervisión débil complementaria, nunca sustituto de causalidad.
- Siempre tres brazos cuando se evalúe el refiner: real, placebo, sin refine.
- No-op permitido y premiable; alquiler por token; condicionar en el modelo base; verificador anti-trampa antes que cualquier optimizador.
- Riesgos aceptados de antemano: ~80% del esfuerzo va a ser infra poco glamorosa (headless, reproducibilidad, timeouts), y la varianza puede comerse efectos chicos — el piloto existe para dimensionar k con números antes de escalar.

---

## 9. Estado epistémico y fuentes

Conviene mantener la disciplina de tres niveles que se usó en toda la investigación: **verificado en código**, **verificado en fuente publicada**, y **reconstrucción**.

- Verificado leyendo el repo `PrimeIntellect-ai/prime-agent` (clonado el 6/8/2026): todo lo de la sección 1 y 2 — defaults de auto-refine (`settings-manager.ts`), pipeline de refinement (`refinement.ts`, ~1000 líneas), fases plan/apply y su no-bloqueo (`agent-session.ts`), serialización y recortes (`compaction/utils.ts`), formato de sesión (`docs/session-format.md`), `create_skill` (`prime-agent-runtime/src/rlm/harness.py`).
- Verificado en fuentes publicadas: blog de Prime Agent (resultados, Factorio, apuesta por co-training, reporte pendiente), paper y substack de Continual Harness (arXiv:2605.09998 — triggers por evento, confianzas, 20.54%/$774), sitio de VISTA, docs/tooling de ARC-AGI-3 (mecánica de RESET, scoring RHAE, acciones gratis), release de los 365k entornos SWE, papers de memory-RL, fact-check público de Psyho.
- Reconstrucción (no publicado por Prime): la config de ARC — cadencia de refines, scope local vs. global, cantidad de ediciones, triggers por evento en la versión nueva, cualquier curva de evolución. El reporte técnico prometido puede cerrar parte de esto; el análisis por edición, casi seguro no.

La regla de la casa, heredada de esta investigación: leer el código antes que el marketing, marcar siempre qué es dato y qué es inferencia, y desconfiar de cualquier claim de "self-evolution" hasta ver qué archivo se escribe y quién lo lee.

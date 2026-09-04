# App Foundry — Documento de Requerimientos (v2)

- **Estado:** Borrador para revisión
- **Fecha:** 2026-08-31
- **Autor:** Juan Francisco Martínez Vera (con asistencia de Claude Code)
- **Fase del proceso:** Requerimientos → (siguiente: TRD v2) → Implementación
- **Parte de:** [REQUIREMENTS.md](./REQUIREMENTS.md) (v1, cerrada) · [TRD.md](./TRD.md) (v1)

> Este documento **no sustituye** al de la v1: lo extiende. Todo lo que la v1 dice sigue vigente salvo donde
> aquí se diga explícitamente lo contrario. La numeración arranca en `RF-1001` y `RNF-601` para que ninguna
> referencia cruzada de la v1 cambie de significado.

---

## 1. Visión de la v2

La v1 dejó un sitio donde escribir una idea, versionarla y conversarla con otras personas. Le falta lo que
pasa **antes** de tener la idea y lo que pasa **cuando no hay nadie más** a quien enseñársela.

La v2 mete inteligencia artificial en los tres momentos donde el producto hoy deja al usuario solo:

1. **La página en blanco.** No tengo una idea, o tengo una intuición y ninguna forma de contrastarla.
2. **El texto flojo.** Tengo la idea escrita, pero el párrafo no dice lo que quiero que diga.
3. **La falta de interlocutor.** Nadie con quien contrastar la idea, o nadie con el perfil adecuado —un
   product owner que sepa de ferrocarriles, alguien que piense como el usuario final, alguien que solo busque
   agujeros—.

Los hitos de la v1 se llamaron *pensar solo* y *pensar en equipo*. Este es **pensar acompañado**: el equipo
deja de depender de que haya gente disponible.

Tres reglas gobiernan todo el documento:

- **Los modelos no son nuestros.** App Foundry no hospeda ni entrena nada. Habla con proveedores externos a
  través de un contrato de plugin, y las credenciales las pone el dueño de cada workspace.
- **La IA propone, la persona dispone.** Ninguna función de IA escribe en el documento, crea una versión ni
  toma una decisión sin que alguien la acepte explícitamente. Lo único que un agente escribe por su cuenta son
  **comentarios**, que es exactamente lo que escribe un colaborador humano sin permiso de edición (RF-803).
- **Lo que no se mide, no entra.** Cada llamada a un modelo consume la cuota de alguien. No hay invocación sin
  registro de quién la provocó y cuántos tokens costó. Se mide en **tokens**, no en dinero: las tarifas son un
  dato de terceros que cambia sin avisarnos y que el producto no puede garantizar.

---

## 2. Objetivos y no-objetivos

### 2.1 Objetivos de v2

| # | Objetivo |
|---|---|
| O9 | Que alguien sin ninguna idea salga de la home del workspace con una app creada y su visión esbozada. |
| O10 | Que mejorar un párrafo de la visión cueste un gesto sobre el texto, sin salir del editor ni perder el control de lo que se escribe. |
| O11 | Que una app pueda tener interlocutores con perfil definido que la critiquen y la mejoren comentando. |
| O12 | Que añadir un proveedor de modelos nuevo sea escribir un adaptador, no tocar el dominio ni la interfaz. |
| O13 | Que el dueño de un workspace sepa en todo momento cuántos tokens consume su IA, en qué y por quién, y pueda ponerle un techo que se respete. |
| O14 | Que el producto de la v1 siga funcionando entero sin configurar ninguna IA: sin proveedor, no hay botones muertos. |

### 2.2 No-objetivos de v2

- **No** hospedamos modelos ni ejecutamos inferencia propia.
- **No** hay entrenamiento, *fine-tuning* ni recuperación sobre corpus externos (RAG).
- **No** hay claves por usuario: la credencial es del workspace y la pone su dueño.
- **No** hay agentes que editen el documento, creen versiones, cambien metadatos ni ejecuten ninguna acción
  sobre la plataforma. Un agente produce texto; la plataforma decide dónde va.
- **No** hay conversación entre agentes: un agente nunca reacciona a lo que escribe otro.
- **No** entra la generación automática de PRD ni TRD a partir de la visión. Sigue fuera, como en la v1.
- **No** entra el servidor MCP, la integración con GitHub ni las tiendas de aplicaciones: pasan a la v3.
- **No** hay runtime de plugins de terceros: en la v2 el contrato de proveedor tiene dos implementaciones, y
  ambas viven en el repositorio.
- **No** hay chat general con un asistente: cada función de IA está anclada a un punto concreto del producto.
- **No** hay generación de imágenes ni de iconos.
- **No** hay notificaciones por email, igual que en la v1.
- **No** hay facturación, ni repercusión de costes, ni cálculo de importes en ninguna moneda: solo medición en
  tokens y cupos.
- **No** se mantiene un catálogo propio de modelos ni de precios: los modelos se leen de la API de cada
  proveedor.

---

## 3. Conceptos nuevos del dominio

| Concepto | Definición |
|---|---|
| **Proveedor** | Servicio externo de modelos (Groq, Anthropic). Se configura en el workspace con su credencial. |
| **Capacidad** | Lo que un proveedor o modelo sabe hacer: streaming, herramientas, búsqueda web, tamaño de contexto. El producto se dibuja a partir de esto, no de una lista fija de proveedores. |
| **Tarea de IA** | Cada uso del producto que invoca un modelo: `IDEA_GENERATION`, `TEXT_ASSIST`, `AGENT_REVIEW`, `AGENT_REPLY`. El dueño asigna un modelo a cada una. |
| **Invocación** | Una llamada concreta a un modelo, con sus tokens de entrada y de salida, su latencia y su desenlace. Unidad de contabilidad y de traza. |
| **Cupo** | Techo mensual de tokens del workspace, uno por proveedor configurado. Al agotarse, ese proveedor deja de invocarse. |
| **Plantilla de agente** | Perfil reutilizable definido en el workspace: nombre, handle, icono y prompt de personalidad. |
| **Agente** | Instancia de una plantilla dentro de una app concreta, con su prompt eventualmente ajustado a esa app. Es quien firma los comentarios. |
| **Revisión** | Encargo explícito a los agentes activos de una app para que lean la visión y comenten sobre ella. |
| **Propuesta** | Cambio de texto sugerido por la IA sobre una selección del documento, que se acepta o se descarta. |

---

## 4. Roles y permisos: qué cambia

La v2 no añade roles. Reparte las capacidades nuevas entre los que ya existen:

| Acción | `OWNER` del workspace | `MEMBER` | Precursor de la app | Miembro con edición | Miembro con lectura |
|---|:---:|:---:|:---:|:---:|:---:|
| Configurar proveedores y credenciales | ✅ | ❌ | — | — | — |
| Asignar modelo a cada tarea | ✅ | ❌ | — | — | — |
| Fijar cupos y límites | ✅ | ❌ | — | — | — |
| Ver el consumo del workspace | ✅ | ✅ *(solo el suyo)* | — | — | — |
| Crear y editar plantillas de agente | ✅ | ❌ | — | — | — |
| Añadir o quitar agentes en una app | — | — | ✅ | ✅ | ❌ |
| Generar ideas en el panel de creación | ✅ | ✅ | — | — | — |
| Usar el asistente de escritura | — | — | ✅ | ✅ | ❌ |
| Pedir una revisión a los agentes | — | — | ✅ | ✅ | ✅ |
| Mencionar a un agente | — | — | ✅ | ✅ | ✅ |

Dos consecuencias que conviene tener delante:

- **Quien gasta no es quien paga.** Un invitado con permiso de edición puede añadir agentes y provocar
  invocaciones contra la credencial del dueño. Es deliberado —si no, colaborar sería mirar—, y lo que lo hace
  soportable son el cupo con corte (RF-1204), el límite por miembro (RF-1206) y que el consumo es
  nominal y visible (RF-1208).
- **Pedir revisión solo pide lectura**, igual que comentar (RF-803, D-12). Un agente no modifica el documento:
  lo que produce son comentarios, y comentar nunca ha exigido permiso de edición. El asistente de escritura,
  en cambio, sí toca el texto, así que exige poder editarlo.

---

## 5. Requerimientos funcionales

`DEBE` = obligatorio en v2. `DEBERÍA` = deseable, sacrificable si aprieta el alcance.

### 5.1 Proveedores de IA en el workspace

- **RF-1001** — El workspace **DEBE** poder tener configurados **proveedores de IA**. La v2 **DEBE** incluir
  **Groq** y **Anthropic**, y el diseño **DEBE** permitir añadir otros sin tocar el dominio ni la interfaz
  (RD-8).
- **RF-1002** — Solo el `OWNER` del workspace **DEBE** poder configurar, modificar y eliminar proveedores.
- **RF-1003** — La credencial la aporta el dueño: es **su** clave del proveedor. El sistema **NO DEBE** ofrecer
  ninguna clave de instancia compartida entre workspaces.
- **RF-1004** — La credencial **DEBE** guardarse cifrada y **NO DEBE** devolverse nunca al cliente, ni entera
  ni descifrable. La interfaz muestra como mucho los últimos caracteres, para reconocerla.
- **RF-1005** — Al guardar una credencial, el sistema **DEBE** validarla contra el proveedor con una llamada
  mínima. Si falla, el proveedor no queda activo y se dice por qué.
- **RF-1006** — Un proveedor **DEBE** poder desactivarse sin borrarse. Desactivar o borrar **DEBE** dejar
  inservibles las tareas asignadas a sus modelos, avisando de cuáles quedan sin proveedor en vez de fallar en
  silencio cuando alguien las use.
- **RF-1007** — Cada proveedor **DEBE** declarar sus **capacidades** —streaming, salida con esquema, uso de
  herramientas, búsqueda web—, y la **lista de modelos DEBE** obtenerse de la API del propio proveedor, con su
  ventana de contexto. El producto **NO** mantiene un catálogo propio ni conoce precios.
- **RF-1008** — La interfaz **DEBE** dibujarse a partir de las capacidades declaradas, no de una lista de
  proveedores conocidos: una función que exija búsqueda web se ofrece degradada y avisada si el modelo
  asignado no la tiene (RF-1305).
- **RF-1009** — El catálogo de modelos **DEBE** cachearse y refrescarse en segundo plano, nunca pedirse al
  pintar una pantalla. Si el proveedor no responde, **DEBE** seguirse usando el último catálogo conocido. Si un
  modelo asignado a una tarea desaparece del catálogo, el sistema **DEBE** avisar al dueño en lugar de fallar
  cuando alguien use esa función.
- **RF-1010** — Sin ningún proveedor activo, **ninguna** función de IA **DEBE** aparecer en la interfaz del
  workspace. No hay botones deshabilitados ni menús que solo llevan a un aviso.
- **RF-1011** — Al activar el primer proveedor, el sistema **DEBE** advertir de forma explícita e inequívoca de
  que a partir de ese momento **el contenido de las apps del workspace se enviará a un tercero** cuando alguien
  use una función de IA, y quién es ese tercero. La advertencia **DEBE** quedar registrada en la auditoría con
  quién la aceptó y cuándo.
- **RF-1012** — El dueño **DEBE** poder apagar toda la IA del workspace de un gesto, sin borrar la
  configuración ni los agentes, y volver a encenderla.

### 5.2 Tareas y asignación de modelos

- **RF-1101** — El sistema **DEBE** distinguir cuatro **tipos de tarea**: generación de ideas, asistencia de
  escritura, revisión de un agente y respuesta de un agente. El modelo se asigna **por tipo**, no por función
  concreta ni por usuario.
- **RF-1102** — Solo el `OWNER` **DEBE** poder asignar qué proveedor y qué modelo atiende cada tipo de tarea.
- **RF-1103** — El sistema **DEBERÍA** proponer una asignación por defecto razonada al configurar el primer
  proveedor —modelo rápido y ligero para asistir a escribir, modelo capaz para ideas y agentes—, editable
  siempre.
- **RF-1104** — Un agente **DEBERÍA** poder fijar un modelo propio distinto del asignado a su tipo de tarea,
  para que convivan personalidades exigentes y ligeras en la misma app.
- **RF-1105** — Cambiar una asignación **NO DEBE** reescribir el pasado: cada resultado ya producido conserva
  con qué proveedor y modelo se generó.
- **RF-1106** — Si el contenido a enviar no cabe en la ventana de contexto del modelo asignado —dato que viene
  del catálogo del proveedor (RF-1007)—, la operación **DEBE** rechazarse con un mensaje que diga qué pasa y qué hacer, en vez de recortar el documento en silencio.
- **RF-1107** — El resto de miembros **NO DEBE** poder elegir modelo en ningún punto de uso. Consumen lo que el
  dueño asignó.

### 5.3 Consumo, cupos y límites

- **RF-1201** — Toda invocación a un modelo **DEBE** quedar registrada con: workspace, app si aplica, quién la
  provocó, tipo de tarea, proveedor, modelo, **tokens de entrada y de salida por separado**, latencia y
  desenlace (completada, fallida, cancelada o cortada por cupo).
- **RF-1202** — El registro **NO DEBE** contener el contenido enviado ni el recibido (RNF-112): mide, no
  archiva.
- **RF-1203** — El consumo **DEBE** expresarse en **tokens**, nunca en importes: el producto no conoce las
  tarifas y no **DEBE** aparentar que sí. Entrada y salida se guardan por separado siempre, de modo que añadir
  precios más adelante permita valorar el histórico entero sin haber perdido ningún dato.
- **RF-1204** — El `OWNER` **DEBE** poder fijar un **cupo mensual de tokens por proveedor**. Un cupo único para
  todos mediría volumen y no gasto: un millón de tokens no vale lo mismo en un proveedor que en otro. Al
  alcanzarse el cupo de un proveedor, el sistema **DEBE** dejar de invocarlo y decirlo con claridad en cada
  punto de uso; las tareas asignadas a otro proveedor con cupo disponible siguen funcionando.
- **RF-1205** — El sistema **DEBE** avisar al dueño al superar un umbral configurable del cupo (por defecto, el
  80 %), con notificación dentro de la aplicación.
- **RF-1206** — El `OWNER` **DEBE** poder limitar el número de invocaciones por miembro y ventana de tiempo,
  con un valor por defecto de instancia.
- **RF-1207** — Antes de una operación que provoque **varias invocaciones de un solo gesto** —una revisión con
  varios agentes—, el sistema **DEBE** estimar los tokens, mostrarlos y pedir confirmación. La estimación
  **DEBE** ser un **techo**: entrada contada de verdad y salida al máximo que esa tarea permite generar, de
  modo que la cifra enseñada nunca se quede corta. Si no cabe en el cupo restante, la operación **NO DEBE**
  arrancar: nunca a medias.
- **RF-1208** — Los ajustes del workspace **DEBEN** incluir una página de **consumo**: gasto del mes en curso
  frente al cupo de cada proveedor, y desglose por tipo de tarea, por modelo y por miembro, separando entrada
  de salida. Cada miembro **DEBE** poder ver su propio consumo.
- **RF-1209** — El consumo **DEBERÍA** poder consultarse por meses anteriores, con un plazo de retención
  configurable de instancia.
- **RF-1210** — El corte por cupo **NO DEBE** afectar a nada que no sea IA: el producto de la v1 sigue
  funcionando entero (O14).

### 5.4 Generación de ideas

- **RF-1301** — El panel de creación de app de la home del workspace **DEBE** ofrecer, junto al campo que ya
  existe para crear a mano, la vía **«no sé qué construir»**: generar ideas a partir de unas restricciones.
- **RF-1302** — Las entradas **DEBEN** incluir, todas opcionales: tema o dominio, tiempo de desarrollo
  disponible, modelo de monetización (gratuita, pago único, suscripción, freemium), público objetivo,
  plataforma y notas libres. Sin rellenar nada, el sistema propone igual.
- **RF-1303** — El resultado **DEBEN** ser entre tres y cinco propuestas **comparables entre sí**, cada una
  con: nombre tentativo, problema que resuelve, para quién es, propuesta de valor, monetización sugerida,
  esfuerzo estimado y riesgo principal.
- **RF-1304** — Si el modelo asignado tiene **búsqueda web** (RF-1007), cada propuesta **DEBE** apoyarse en
  información contrastable y **DEBE** mostrar sus fuentes con enlace.
- **RF-1305** — Si no la tiene, el sistema **DEBE** decir explícitamente que las ideas salen del conocimiento
  del modelo y no de datos actuales de mercado. Nunca se presenta como fundamentado lo que no lo está.
- **RF-1306** — Las propuestas **DEBERÍAN** aparecer conforme se generan, sin esperar al lote completo.
- **RF-1307** — El usuario **DEBE** poder pedir otra tanda conservando sus entradas, y las propuestas ya vistas
  **NO DEBEN** repetirse en la siguiente.
- **RF-1308** — Al elegir una propuesta, el sistema **DEBE** crear la app con su nombre, descripción, estado
  `IDEA` y las etiquetas sugeridas, y **DEBE** dejar el `VISION.md` como **borrador en la copia de trabajo, sin
  commitear** (RF-505), siguiendo la estructura de la plantilla de la v1 (RF-503).
- **RF-1309** — Tras elegir, el usuario **DEBE** aterrizar en el editor de esa app, con el borrador delante y
  el aviso de que hay cambios sin commitear.
- **RF-1310** — El nivel de acceso y el precursor de una app creada así **DEBEN** seguir exactamente las reglas
  de la v1 (RF-401, D-9): crearla con ayuda de la IA no cambia de quién es.
- **RF-1311** — La app **DEBE** guardar constancia de que su visión nació de una propuesta generada, visible en
  la ficha mientras nadie haya commiteado todavía.
- **RF-1312** — Las propuestas descartadas **NO** se guardan: si nadie elige ninguna, no queda rastro más allá
  del registro de la invocación (RF-1201).

### 5.5 Asistente de escritura del documento

- **RF-1401** — El editor del `VISION.md` **DEBE** ofrecer acciones de IA **sobre el texto seleccionado**,
  desde el mismo menú de selección que ya sirve para comentar. Seleccionar texto **DEBE** ofrecer, en un único
  menú, comentar y las acciones de IA: son dos cosas que se hacen sobre lo mismo y no merecen dos gestos
  distintos.
- **RF-1402** — Las acciones **DEBEN** ser un conjunto fijo y corto: mejorar la redacción, concretar, resumir,
  expandir y corregir. **No** hay campo de instrucción libre en la v2.
- **RF-1403** — El resultado **DEBE** presentarse como **propuesta de cambio con diff** frente al texto
  seleccionado, nunca aplicado de antemano.
- **RF-1404** — El usuario **DEBE** poder aceptar o descartar la propuesta. Aceptar la aplica a la **copia de
  trabajo**; descartar no deja rastro en el documento.
- **RF-1405** — Aceptar una propuesta **NUNCA DEBE** crear una versión: commitear sigue siendo un acto humano y
  explícito (RF-505).
- **RF-1406** — El asistente **DEBE** exigir permiso de edición sobre la app. Con solo lectura no aparece.
- **RF-1407** — El texto propuesto **DEBERÍA** llegar en streaming, para que se pueda descartar sin esperar al
  final.
- **RF-1408** — Si la copia de trabajo cambió mientras se generaba la propuesta, aplicarla **DEBE** rechazarse
  con la misma protección que un guardado concurrente (RF-511), y ofrecer ver qué cambió.
- **RF-1409** — La selección enviada **DEBE** acompañarse del documento como contexto solo si cabe en la
  ventana del modelo; si no cabe, se envía la selección y su entorno inmediato, y se dice.
- **RF-1410** — El asistente **NO DEBE** poder invocarse sobre una versión anterior del documento, solo sobre
  la copia de trabajo, que es lo único editable.
- **RF-1411** — Las mismas acciones **DEBEN** poder pedirse **sobre el documento entero**, no solo sobre una
  selección, desde los controles del editor. El resultado sigue siendo una propuesta con diff que se acepta o
  se descarta, no crea versión y respeta la comprobación de concurrencia: cambia el alcance, no las reglas.
- **RF-1412** — Antes de una acción sobre el documento entero, el sistema **DEBE** mostrar el techo de tokens
  estimado (§5.3): es la operación interactiva más cara del producto y conviene que no sea una sorpresa.
- **RF-1413** — El asistente **NO DEBE** ofrecer acciones de **diagnóstico** —detectar huecos, revisar
  coherencia, proponer estructura—. Eso es lo que hace una revisión de agente (RF-1606), que además ancla cada
  observación a su fragmento y deja conversación en vez de un texto reescrito. Dos funciones que hacen lo
  mismo, ambas peor, es lo que hay que evitar.

#### El menú de selección

Estas tres son deuda de la v1 que la v2 **DEBE** saldar: el asistente cuelga del mismo menú, así que sus
fallos dejan de ser una molestia al comentar y pasan a inutilizar media función nueva.

- **RF-1414** — El menú **DEBE** situarse a partir de la **geometría de la selección** —bajo su última línea,
  alineado a su derecha—, nunca a partir de la posición del puntero. Con el puntero como referencia, arrastrar
  deprisa o de derecha a izquierda deja el menú lejos del texto o directamente encima de él. Si no cabe abajo,
  **DEBE** colocarse arriba, y siempre dentro de la ventana.
- **RF-1415** — La selección **DEBE** detectarse por el **cambio de selección del documento**, no por soltar
  el ratón. Con `mouseup` como disparador, el doble clic sobre una palabra, el triple clic sobre un párrafo,
  la selección con teclado y el arrastre que termina fuera del texto no producen menú, aunque la selección
  exista y sea válida.
- **RF-1416** — Una selección que abarca un **bloque entero** —un título, un párrafo completo— **DEBE**
  resolverse a ese bloque. Hoy no se resuelve, porque al cubrirlo del todo el navegador devuelve como
  contenedor común el elemento padre, que ya no lleva el rastro de posición en el fuente. No es cosa del
  markdown: es de dónde se busca ese rastro.

### 5.6 Agentes: plantillas e instancias

- **RF-1501** — El workspace **DEBE** permitir definir **plantillas de agente** reutilizables, con: nombre,
  handle, icono (emoji y color, como las apps: D-14), prompt de personalidad y, opcionalmente, modelo propio
  (RF-1104).
- **RF-1502** — Solo el `OWNER` del workspace **DEBE** poder crear, editar y borrar plantillas.
- **RF-1503** — Una app **DEBE** poder tener **agentes**, cada uno instanciado a partir de una plantilla del
  workspace. Quien pueda **editar** la app puede añadirlos y quitarlos.
- **RF-1504** — Al instanciar, el prompt **DEBE** poder ajustarse para esa app sin modificar la plantilla, y la
  interfaz **DEBE** mostrar de qué plantilla desciende y si se ha desviado de ella.
- **RF-1505** — Editar una plantilla **NO DEBE** modificar las instancias ya creadas. El sistema **DEBERÍA**
  avisar en las apps afectadas de que su plantilla de origen cambió, y ofrecer adoptar el cambio.
- **RF-1506** — El handle de un agente **DEBE** ser único dentro de su app y **DEBE** distinguirse
  visualmente del de una persona en todas partes donde aparezca. Nadie debe confundir a un agente con un
  compañero.
- **RF-1507** — Una app **DEBE** tener un número máximo de agentes, configurable de instancia, con un valor por
  defecto conservador (cinco). El tope existe porque una revisión los invoca a todos de un gesto.
- **RF-1508** — Un agente **DEBE** poder desactivarse sin borrarse: deja de intervenir y sus comentarios siguen
  donde están.
- **RF-1509** — Quitar un agente de una app **NO DEBE** borrar lo que escribió. Sus comentarios conservan su
  autoría y su icono, marcados como de un agente retirado (mismo criterio que RF-813 para personas).
- **RF-1510** — Cada comentario escrito por un agente **DEBE** guardar el prompt con el que se generó, de modo
  que editar la personalidad después no reescriba la historia de por qué dijo lo que dijo.
- **RF-1511** — La ficha de la app **DEBE** mostrar sus agentes, con su icono, su perfil y su estado. Los
  agentes **NO DEBEN** aparecer en la lista de contribuidores, que sigue derivándose del historial de versiones
  y es de personas (RF-509, D-8).
- **RF-1512** — Los agentes de una app **NO DEBEN** ser visibles ni mencionables desde otra app, aunque
  compartan plantilla y workspace.
- **RF-1513** — El producto **DEBE** traer un **catálogo de plantillas de fábrica**: al menos Product Owner,
  marketing, dirección técnica, diseño y experiencia de uso, abogado del diablo, y datos y métricas. Seis
  perfiles que no se pisan, para que nadie tenga que redactar un prompt de personalidad antes de poder usar la
  función por primera vez.
- **RF-1514** — El catálogo **DEBE** vivir en el propio producto y no en la base de datos: no es contenido de
  nadie, no se edita desde la aplicación y mejora con cada versión. Adoptar una de sus plantillas **DEBE**
  copiarla al workspace, y a partir de ahí es una plantilla propia como cualquier otra (RF-1501, RF-1502):
  se edita, se borra y **deja de seguir al catálogo**. Adoptarla es, por tanto, crear una plantilla, y solo el
  `OWNER` **DEBE** poder hacerlo.
- **RF-1515** — Un workspace sin plantillas propias **DEBE** ofrecer el catálogo en lugar de un estado vacío, y
  adoptar una **DEBERÍA** ser un solo gesto. Si el handle de la plantilla adoptada ya existe en ese workspace,
  el sistema **DEBE** decirlo y dejar elegir otro, nunca sobrescribir la que había.

### 5.7 Agentes: cuándo hablan y qué escriben

- **RF-1601** — Lo único que un agente **DEBE** poder producir son **comentarios** en su app: hilos generales e
  inline, y respuestas. **NO DEBE** poder editar el documento, crear versiones, cambiar metadatos, resolver
  hilos ajenos, invitar a nadie ni ejecutar ninguna otra acción del producto.
- **RF-1602** — Un agente **DEBE** intervenir en exactamente tres situaciones, y en ninguna más:
  1. cuando una **persona** lo menciona con `@handle` en un comentario de su app;
  2. cuando alguien pide una **revisión** de la app;
  3. cuando una **persona** responde dentro de un hilo en el que ese agente ya participa.
- **RF-1603** — **NO DEBE** haber intervención automática al commitear una versión. Se descartó a propósito:
  convertiría cada commit en gasto y sepultaría el documento en comentarios.
- **RF-1604** — Un agente **NUNCA DEBE** reaccionar a lo escrito por otro agente. Una mención escrita por un
  agente **NO DEBE** invocar a nadie ni notificar a nadie.
- **RF-1605** — Cada hilo **DEBE** tener un tope de intervenciones por agente, configurable de instancia (por
  defecto, tres). Alcanzado el tope, el agente calla hasta que se le mencione otra vez explícitamente.
- **RF-1606** — Una **revisión** consiste en que cada agente activo de la app lea la visión y abra los hilos
  inline que considere sobre fragmentos concretos, más un hilo general con su valoración de conjunto.
- **RF-1607** — La revisión **DEBE** hacerse sobre la **versión actual** del documento, nunca sobre la copia de
  trabajo: un comentario inline pertenece a la versión sobre la que se escribió y se ancla a su texto
  (RF-808, RF-817). Si hay cambios sin commitear, el sistema **DEBE** advertir de que el agente no los verá.
- **RF-1608** — Pedirla **DEBE** requerir solo permiso de lectura sobre la app (RF-803, D-12), y **DEBE**
  pasar por la estimación de tokens y la confirmación de RF-1207.
- **RF-1609** — Dos revisiones de la misma app **NO DEBEN** solaparse. Mientras haya una en curso, la interfaz
  **DEBE** mostrar su progreso e impedir lanzar otra.
- **RF-1610** — Una revisión **DEBE** poder cancelarse mientras corre. Lo ya escrito se queda; lo pendiente no
  se lanza.
- **RF-1611** — Todo comentario de un agente **DEBE** identificarse visiblemente como generado por IA, en el
  propio comentario y en el panel de hilos, sin depender del icono.
- **RF-1612** — Un agente **NO DEBE** recibir notificaciones. Las personas **DEBEN** recibirlas por lo que
  escriben los agentes con las mismas reglas que rigen para las personas (RF-902), y **DEBERÍAN** poder
  silenciar los avisos de un agente concreto.
- **RF-1613** — Los comentarios de agente **DEBEN** contar como hilos abiertos igual que los demás (RF-811) y
  ser buscables como los demás. El listado **DEBERÍA** permitir distinguir los hilos con participación de IA.
- **RF-1614** — El texto del documento y de los comentarios que se entrega a un agente son **datos, no
  instrucciones**: un documento que pida al agente saltarse su perfil no **DEBE** cambiar su comportamiento. La
  garantía estructural es RF-1601 —un agente sin herramientas solo puede escribir un mal comentario—, y el
  sistema **DEBE** además separar explícitamente perfil y contenido al construir la petición.

### 5.8 Transparencia y auditoría

- **RF-1701** — Todo lo que produce la IA **DEBE** estar marcado como tal allí donde se lea: propuestas de
  texto, ideas y comentarios de agente.
- **RF-1702** — La auditoría **DEBE** registrar, como mínimo: proveedor configurado, modificado, activado,
  desactivado o borrado; aceptación de la advertencia de envío a terceros (RF-1011); cupos y límites
  cambiados; cupo agotado; plantilla de agente creada, editada o borrada; agente añadido,
  ajustado, desactivado o retirado de una app; revisión solicitada y cancelada.
- **RF-1703** — La auditoría **NO DEBE** registrar credenciales, contenido de documentos, texto de comentarios
  ni cuerpo de los prompts (RF-706, RNF-112). De un prompt se registra que cambió, no lo que dice.
- **RF-1704** — El usuario **DEBERÍA** poder ver, en un resultado concreto de IA, con qué proveedor y modelo se
  generó.
- **RF-1705** — Un comentario de agente **DEBE** poder borrarlo el precursor de la app, igual que cualquier
  otro hilo (RF-806).

---

## 6. Requerimientos no funcionales

### 6.1 Seguridad

- **RNF-601** — Las credenciales de proveedor **DEBEN** cifrarse en reposo con una clave de instancia que no
  está en la base de datos ni en el repositorio, y que se inyecta por entorno (RNF-106).
- **RNF-602** — Ninguna credencial **DEBE** aparecer jamás en respuestas de la API, logs, trazas, métricas,
  mensajes de error del proveedor reenviados al cliente ni auditoría.
- **RNF-603** — Las tablas nuevas **DEBEN** quedar acotadas por workspace en el nivel más bajo del acceso a
  datos, con la misma garantía que el resto (RNF-103, RD-6). Un miembro que no es dueño **NO DEBE** poder leer
  la credencial de su propio workspace.
- **RNF-604** — El sistema **DEBE** enviar a un proveedor únicamente el contenido de las apps que el usuario
  que provoca la invocación puede ver. Una función de IA no es una vía para leer lo que no te corresponde.
- **RNF-605** — Los agentes **NO DEBEN** disponer de herramientas que actúen sobre la plataforma (RF-1601):
  toda ampliación futura pasará por el mismo modelo de permisos que la interfaz (RD-9).
- **RNF-606** — Las respuestas del modelo **DEBEN** sanearse antes de renderizarse, con el mismo tratamiento
  que el contenido escrito por personas (RF-513).
- **RNF-607** — Los endpoints que invocan modelos **DEBEN** tener límite de tasa propio, independiente del
  límite general (RNF-109).

### 6.2 Rendimiento y resiliencia

- **RNF-701** — Ninguna invocación a un modelo **DEBE** bloquear una petición HTTP hasta su final: las
  interactivas van en **streaming** y las de abanico —las revisiones— en **segundo plano**, informando de su
  progreso por el canal de tiempo real que ya existe (T-6).
- **RNF-702** — Toda invocación **DEBE** tener tiempo máximo y poder cancelarse; cancelar **DEBE** cortar
  también la llamada al proveedor, no solo dejar de escuchar.
- **RNF-703** — Los fallos transitorios del proveedor **DEBEN** reintentarse con espera creciente y un tope; los
  demás, no. Un reintento **NUNCA DEBE** duplicar comentarios ya escritos.
- **RNF-704** — Un proveedor caído o que falla de forma sostenida **DEBE** dejar de intentarse durante un
  tiempo, y las funciones que dependen de él **DEBEN** decir que el proveedor no responde, no fallar de forma
  genérica.
- **RNF-705** — Las revisiones **DEBEN** ejecutarse con concurrencia acotada, para que varias a la vez no
  saturen ni el proveedor ni la instancia.
- **RNF-706** — La primera palabra de una acción interactiva **DEBERÍA** llegar en menos de dos segundos con un
  modelo rápido; el producto **DEBE** mostrar progreso desde el primer instante en cualquier caso.
- **RNF-707** — Dimensionado de v2: el de la v1 (RNF-201) más decenas de invocaciones por workspace y día y
  unidades de agentes por app.

### 6.3 Observabilidad

- **RNF-801** — Cada invocación **DEBE** generar una traza propia, hija de la petición que la originó, con
  proveedor, modelo, tipo de tarea, tokens, latencia hasta la primera palabra, latencia total y desenlace.
  Nunca el contenido.
- **RNF-802** — **DEBEN** exponerse métricas de: invocaciones por proveedor, modelo y tipo de tarea; tokens
  consumidos, separando entrada de salida; consumo acumulado frente al cupo; tasa de error por proveedor; y
  latencia en percentiles.
- **RNF-803** — **DEBE** existir un panel de Grafana de la IA, con gasto, errores y latencia por proveedor,
  junto a los que ya existen.
- **RNF-804** — El agotamiento de un cupo y la apertura del cortacircuitos de un proveedor **DEBEN** ser
  eventos observables, no solo un mensaje en la interfaz.

### 6.4 Calidad

- **RNF-901** — Los tests **NO DEBEN** llamar a ningún proveedor real: **DEBE** existir un proveedor de mentira
  que implemente el mismo contrato, con respuestas deterministas, errores y streaming simulados.
- **RNF-902** — **DEBEN** cubrirse con tests explícitos los cortafuegos de bucle de RF-1604 y RF-1605: que un
  agente no reacciona a otro, que una mención de agente no invoca, y que el tope de turnos se respeta.
- **RNF-903** — **DEBEN** cubrirse el corte por cupo (RF-1204), la comprobación previa al abanico
  (RF-1207) y el límite por miembro (RF-1206), incluyendo sus casos negativos.
- **RNF-904** — Las tablas nuevas **DEBEN** entrar en la suite de aislamiento existente, ejecutada con el rol
  de la aplicación, incluyendo que nadie salvo el dueño lee la credencial.
- **RNF-905** — **DEBERÍA** existir un recorrido de extremo a extremo que cubra: configurar proveedor falso,
  generar ideas, crear la app desde una de ellas, mejorar un párrafo y pedir una revisión que deja comentarios.

### 6.5 Operación

- **RNF-1001** — La instancia **DEBE** seguir levantándose con un único comando y funcionando entera sin
  ninguna clave de proveedor configurada (RNF-301, O14).
- **RNF-1002** — Los valores por defecto de instancia —tope de agentes por app, tope de turnos por hilo, límite
  de invocaciones por miembro, retención del consumo— **DEBEN** venir de configuración documentada en
  `.env.example` (RNF-304).
- **RNF-1003** — El *seed* de ejemplo **DEBERÍA** incluir el proveedor de mentira y un par de plantillas de
  agente adoptadas del catálogo de fábrica (RF-1513), para poder probar el flujo completo sin consumir la cuota
  de nadie y sin una segunda colección de prompts que mantener al día.

---

## 7. Criterios de aceptación de la v2

La v2 está terminada cuando, en una instancia local:

1. Un workspace recién creado no muestra ni una sola función de IA hasta que su dueño configura un proveedor.
2. El dueño configura Groq y Anthropic con sus claves, y una clave inválida se rechaza en el acto y con
   motivo.
3. Un miembro que no es dueño no puede leer, ni por la API ni por la interfaz, la credencial del workspace.
4. El dueño asigna un modelo distinto a cada tipo de tarea, y cada función usa el suyo.
5. Alguien sin ninguna idea rellena las restricciones, obtiene cuatro propuestas comparables, elige una y
   aterriza en el editor de una app nueva con su visión esbozada y sin commitear.
6. Con un modelo con búsqueda web, las propuestas citan fuentes; con uno sin ella, la interfaz avisa de que no
   están fundamentadas en datos actuales.
7. Se selecciona un párrafo flojo, se pide concretarlo, se ve el diff y se descarta: el documento queda
   exactamente igual que estaba. Se repite aceptando: el cambio está en la copia de trabajo y no hay versión
   nueva.
8. El menú aparece bajo la selección y a su derecha seleccionando con doble clic, con triple clic, con el
   teclado, arrastrando hacia la izquierda y sobre un título; y ofrece comentar y las acciones de IA juntas.
9. Se pide mejorar el documento entero: se ve el techo de tokens antes, y el resultado llega como un diff
   sobre todo el texto que también se puede descartar sin dejar rastro.
10. El dueño abre un workspace sin plantillas propias, encuentra el catálogo de fábrica en vez de un estado
    vacío, adopta dos de sus perfiles de un gesto y las instancia en una app; una de ellas con el prompt
    ajustado para esa app. Editar la copia adoptada no cambia nada del catálogo, ni al revés.
11. Se menciona a un agente en un hilo y responde en su papel; se le responde y vuelve a contestar; al tercer
    turno calla.
12. Un agente no responde jamás a lo que escribe otro, y una mención escrita por un agente no invoca a nadie.
13. Se pide una revisión: se muestran los tokens estimados, se confirma, y los agentes dejan hilos anclados
    a fragmentos concretos de la versión actual, más su valoración general.
14. Con cambios sin commitear, pedir revisión avisa de que el agente no los verá.
15. Se cancela una revisión a medias: lo escrito permanece y no aparece nada más.
16. Se agota el cupo de un proveedor: sus funciones se apagan con un mensaje claro, las tareas asignadas al
    otro proveedor siguen funcionando, el resto del producto entero también, y el dueño recibe el aviso.
17. La página de consumo muestra los tokens del mes desglosados por proveedor, tarea, modelo y miembro,
    separando entrada de salida, y cuadra con las invocaciones registradas.
18. La auditoría contiene el rastro de configuración, cupos y agentes, y no contiene ni una credencial
    ni una línea del contenido de ninguna app.
19. Todo comentario de agente se distingue de uno humano de un vistazo, y sigue ahí, con su autoría, después de
    retirar al agente.
20. La suite completa pasa sin llamar ni una vez a un proveedor real.

---

## 8. Restricciones de diseño nuevas

Se suman a RD-1..RD-7 de la v1, que siguen vigentes.

- **RD-8 — Una sola puerta al exterior.** Ningún módulo del producto habla directamente con el SDK ni con la
  API de un proveedor: todo pasa por el contrato de proveedor. Añadir uno nuevo es escribir un adaptador y
  declarar sus capacidades.
- **RD-9 — Agentes sin manos.** Un agente produce texto y nada más. El día que se le den herramientas, pasarán
  por el mismo modelo de permisos que la interfaz, y no antes.
- **RD-10 — No hay invocación sin cuenta.** Toda llamada a un modelo nace con su registro de contabilidad y su
  traza. Una ruta que invoque un modelo sin pasar por ahí es un error de diseño, no un atajo.
- **RD-11 — Tareas extensibles.** El tipo de tarea es un enum, como `documents.type` (RD-4): añadir un uso
  nuevo de IA no debe rehacer la configuración del workspace.
- **RD-12 — La IA es opcional.** Ninguna función de la v1 puede pasar a depender de que haya un proveedor
  configurado.
- **RD-13 — El contrato se gana con dos.** El contrato de proveedor nace con dos implementaciones reales y
  distintas. Es el ensayo del runtime de plugins de la v3: lo que no sostenga a Groq y a Anthropic a la vez,
  no está listo para terceros.

---

## 9. Fuera de alcance de v2 — dirección del producto

El roadmap de la v1 (sección 9 de [REQUIREMENTS.md](./REQUIREMENTS.md)) se reordena así:

| Versión | Contenido |
|---|---|
| **v3 — Integraciones** | Runtime de plugins de terceros sobre el contrato que estrena la v2; servidor MCP para operar App Foundry desde un agente externo; integración real con GitHub (releases, KPIs, webhooks, acciones) y con las tiendas de aplicaciones. |
| **v4 — Cadena de especificación** | PRD derivados de la visión, TRD derivados de los PRD y tareas derivadas de los TRD, con trazabilidad entre niveles. Con la v2 hecha, derivarlos deja de ser un problema de generación y pasa a ser uno de modelo. |
| **v5 — SaaS** | Despliegue gestionado, workspaces de equipo, planes y facturación, endurecimiento del aislamiento entre clientes. |

---

## 10. Decisiones tomadas

| # | Decisión | Motivo |
|---|---|---|
| D-23 | La v2 va de **IA para definir ideas**; MCP y GitHub se van a la v3. | El producto falla hoy en la página en blanco y en la falta de interlocutor, no en la falta de integraciones. |
| D-24 | **Los proveedores se configuran por workspace, con la clave de su dueño.** | No hospedamos modelos y no queremos pagar la inferencia de nadie; y la clave del dueño es la única frontera de coste que coincide con la de datos. |
| D-25 | Groq y Anthropic, **detrás de un contrato de plugin**, en la v2. | Dos proveedores que no se parecen obligan al contrato a ser real desde el primer día (RD-13). |
| D-26 | Un agente es una **entidad propia**, no un usuario con una marca. | Se le puede mencionar y firma sus comentarios, pero jamás puede tener sesión: la tabla que gobierna el login y la RLS se queda solo con personas. |
| D-27 | Un agente habla **al ser mencionado, al pedirle revisión y al responderle en su hilo**; nunca al commitear. | Los tres primeros los pide una persona; el cuarto convertiría cada guardado en gasto y en ruido. |
| D-28 | **Un agente nunca reacciona a otro agente**, y hay tope de turnos por hilo. | Sin esto, dos personalidades se enzarzan solas y la factura la paga el dueño mientras duerme. |
| D-29 | Las ideas se fundamentan con la **búsqueda web del proveedor** si la tiene, y si no se dice. | «Tendencias de mercado» salidas de la memoria de un modelo son una invención con buen aspecto. |
| D-30 | **Cupo mensual de tokens por proveedor, con corte**, más límite por miembro y contabilidad nominal. | Quien gasta no es quien paga: sin techo, colaborar es poder vaciar la cuenta de otro. Y el cupo va por proveedor porque un millón de tokens no vale lo mismo en cada uno. |
| D-37 | **Se mide en tokens, no en dinero**, y la lista de modelos se lee de la API de cada proveedor. | Las tarifas son un dato de terceros que cambia sin avisarnos: un importe calculado con una tabla propia envejece mal y aparenta una precisión que no tenemos. Entrada y salida se guardan por separado para poder valorarlo todo el día que haga falta. |
| D-31 | Los agentes se definen como **plantillas del workspace instanciadas en cada app**. | La personalidad se escribe una vez y se afina donde toca; copiar y pegar prompts es como se degradan. |
| D-32 | Elegir una idea generada **crea la app y siembra la visión sin commitear**. | Cierra el flujo entero desde «no tengo ideas» hasta «tengo algo que refinar», y respeta que versionar es un acto humano (RF-505). |
| D-33 | El asistente de escritura son **acciones fijas sobre la selección, con diff que se acepta o descarta**. | Poco intrusivo, reversible y sin caja de chat dentro del editor; reutiliza el menú de selección que ya existe. |
| D-34 | El **dueño asigna modelo por tipo de tarea**; nadie más elige. | Es donde se decide el gasto, y es lo que hace útil tener dos proveedores a la vez: uno rápido para reescribir, uno capaz para razonar. |
| D-35 | La revisión de un agente se hace sobre la **versión actual**, no sobre la copia de trabajo. | Un comentario inline pertenece a la versión sobre la que se escribió (RF-817); anclarlo a texto sin commitear sería nacer huérfano. |
| D-36 | **Los agentes no tienen herramientas** sobre la plataforma. | Es lo que convierte la inyección de instrucciones en un problema de calidad del comentario y no en uno de seguridad. |

---

## 11. Preguntas abiertas

Ninguna. Las quince decisiones de la sección 10 cierran los tres casos de uso, el modelo de proveedores y el
de consumo. Las ocho preguntas técnicas que quedaban abiertas se resolvieron una a una y viven en el TRD de la
v2: contrato de proveedor, adaptadores, cifrado de credenciales, cola de revisiones, modelo de datos de
agentes, contabilidad, estimación previa y catálogo de modelos.

El PRD queda cerrado. Lo siguiente es el TRD.

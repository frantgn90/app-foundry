# App Foundry — Tareas

- **Documentos origen:** [REQUIREMENTS.md](./REQUIREMENTS.md) · [TRD.md](./TRD.md)
- **Método:** una tarea es la unidad más pequeña que se puede **verificar por separado**. Cada una lleva su
  criterio de verificación y termina en un commit propio.
- **Refinamiento progresivo:** solo se desglosa en detalle el hito en curso. Los siguientes se mantienen a
  grano grueso y se detallan al cerrar el anterior, porque lo que aprendamos en un hito cambia el siguiente.

**Leyenda:** ⬜ pendiente · 🔄 en curso · ✅ hecha y verificada

---

## Estado: v1 cerrada (31 de agosto de 2026)

Los ocho hitos están hechos y verificados: 145 tareas más 25 mejoras salidas de usar el producto.

De los requisitos quedan dos salvedades, ambas decididas a conciencia y anotadas abajo, no olvidadas:
**RF-206** (editar nombre visible y avatar) no se implementa —el perfil se hereda de GitHub y solo se
muestra—, y **RF-605** se cumple en su intención pero no en su letra: la acción de crear es lo más visible de
la pantalla, aunque ya no sea un botón llamado «Nueva app». Todo lo demás está cumplido, incluidas las
**DEBERÍA**. El porqué de cada decisión está en [Decisiones tomadas sobre
requisitos](#decisiones-tomadas-sobre-requisitos).

Lo que sostiene la afirmación, ejecutable en local con un comando:

| Suite | Qué cubre | Cuántos |
|---|---|---|
| API | Cada ruta con sus casos negativos, contra Postgres real | 149 |
| Aislamiento | Las políticas RLS ejecutadas con el rol de la aplicación, no como superusuario | 87 |
| Unitarios | Anclaje, reanclaje, audiencia de los avisos, configuración | 79 |
| Extremo a extremo | Cinco recorridos, uno de ellos con dos identidades a la vez | 5 |

**Lo único que queda decidido a medias** es qué hacer con las apps del workspace personal de una cuenta
desactivada cuando vencen los noventa días de gracia y no hay a quién dárselas (RF-414). No bloquea: hasta
que alguien lo decida, las apps siguen ahí y el plazo solo está apuntado.

---

## H0 — Andamiaje

> Objetivo: que exista el esqueleto sobre el que se apoya todo lo demás, con observabilidad y CI desde el
> primer día (TRD §20). Al terminar H0 no hay producto usable, pero sí un `pnpm dev` que arranca, una base de
> datos con migraciones, una traza visible en Grafana y un CI en verde.

### Bloque A — Monorepo

| #   | Tarea                                                                                    | Verificación                                              | Traza          | Estado |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------- | ------ |
| A1  | Repositorio git, `.gitignore`, `.editorconfig`, `.nvmrc` y commit de los documentos      | `git log` muestra el commit inicial                       | —              | ✅     |
| A2  | Este documento de tareas                                                                 | Existe y refleja el plan del TRD §20                      | TRD §20        | ✅     |
| A3  | Raíz del monorepo: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `README.md`      | `pnpm install` termina sin errores                        | T-11           | ✅     |
| A4  | `packages/config`: tsconfig base, ESLint plano y Prettier compartidos                    | `pnpm lint` y `pnpm typecheck` corren en vacío sin fallar | RNF-403        | ✅     |
| A5  | `packages/core`: entidades, enums de dominio y funciones puras de permisos con sus tests | `pnpm test:unit` pasa con tests reales de autorización    | RD-1, §4, §6.3 | ✅     |

### Bloque B — Infraestructura local

| #   | Tarea                                                                                          | Verificación                                                                               | Traza                | Estado |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------- | ------ |
| B1  | `infra/docker-compose.yml` con PostgreSQL 18.6 y Redis, con healthchecks y volúmenes           | `docker compose up -d` deja ambos servicios _healthy_                                      | T-15, T-6            | ✅     |
| B2  | Stack de observabilidad (OTel Collector, Tempo, Loki, Prometheus, Grafana) en un perfil aparte | `docker compose --profile obs up -d` levanta Grafana con sus fuentes de datos configuradas | T-4, §13, riesgo §18 | ✅     |
| B3  | `.env.example` y módulo de configuración validada al arrancar                                  | Arrancar sin una variable obligatoria falla con un mensaje claro                           | RNF-304, RNF-106     | ✅     |

### Bloque C — Base de datos

| #   | Tarea                                                                                              | Verificación                                                               | Traza        | Estado |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------ | ------ |
| C1  | `packages/db`: Drizzle, `drizzle-kit`, conexión y separación de roles `app_user` / migraciones     | `pnpm db:migrate` aplica sobre una base limpia                             | T-3, §6.1    | ✅     |
| C2  | Migración base: extensiones, enums, funciones `current_app_user()` y `user_workspaces()`, `GRANT`s | El esquema aplica en limpio y las funciones existen con `search_path` fijo | §6.1         | ✅     |
| C3  | Tablas `users` y `sessions` con sus índices                                                        | El esquema declarado en Drizzle coincide con el aplicado                   | §5.1         | ✅     |
| C4  | Testcontainers y **test canario de RLS**: `app_user` no ve lo que no debe                          | El test falla si se ejecuta como superusuario, y pasa como `app_user`      | RNF-401, §14 | ✅     |

### Bloque D — Aplicaciones

| #   | Tarea                                                                                         | Verificación                                                                     | Traza        | Estado |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------ | ------ |
| D1  | `apps/api`: NestJS mínimo con `/health/live`, `/health/ready` y OpenAPI                       | `curl /health/ready` responde comprobando Postgres y Redis                       | §8, §13      | ✅     |
| D2  | OpenTelemetry inicializado antes de Nest, `pino` con `trace_id`, redacción de datos sensibles | Una petición aparece en Tempo con su span de SQL, y su log enlaza con la traza   | T-4, RNF-112 | ✅     |
| D3  | `apps/web`: Vite, React, Tailwind, shadcn/ui, tema claro y oscuro                             | `pnpm dev` sirve una página que consulta `/health` y respeta el tema del sistema | T-9, RF-609  | ✅     |
| D4  | `packages/contracts`: generación del cliente tipado desde el OpenAPI                          | El cliente generado compila y la SPA lo usa para llamar a `/health`              | T-8          | ✅     |

### Bloque E — Integración continua

| #   | Tarea                                                                                   | Verificación                                     | Traza       | Estado |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------- | ------ |
| E1  | GitHub Actions: lint, typecheck, unit, integración, build y verificación de migraciones | El workflow pasa en verde sobre este repositorio | T-16, §15.1 | ✅     |

---

## H1 — Entrar y tener espacio propio

> Objetivo: que una persona entre con GitHub, reciba su workspace personal y pueda invitar a otros al suyo.
> Al terminar H1 el producto todavía no sirve para pensar —eso llega en H2— pero ya tiene identidad,
> aislamiento real entre personas y colaboración declarada.
>
> Aquí se cierran además las dos deudas que dejó H0: el autoascenso a `ADMIN` y el acceso a `users` durante
> el login.

### Bloque F — Modelo de workspaces y aislamiento

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| F1 | Tablas `workspaces`, `workspace_members` y `workspace_invitations` con sus índices | El esquema declarado coincide con el aplicado y CI sigue verde | §5.2 | ✅ |
| F2 | Función `user_workspaces()` con `SECURITY DEFINER` y `search_path` fijo | Una política que la use no entra en recursión sobre `workspace_members` | §6.1 | ✅ |
| F3 | Políticas RLS de workspaces, membresías e invitaciones | Un usuario no ve workspaces ajenos ni sus miembros | RNF-103, RD-6 | ✅ |
| F4 | Ampliar la política de `users` a quienes comparten workspace | Se ve a los compañeros de workspace y a nadie más | RF-815 | ✅ |
| F5 | **Cerrar el autoascenso a `ADMIN`**: `GRANT UPDATE` por columna | El test que hoy documenta el ascenso pasa a comprobar que ya no ocurre | T-20, deuda de H0 | ✅ |
| F6 | Función `SECURITY DEFINER` acotada para el login | Devuelve solo lo que la autenticación necesita y no permite enumerar usuarios | T-19, deuda de H0 | ✅ |
| F7 | Ampliar la suite de aislamiento a los nuevos casos | Tests negativos para cada regla de la matriz §3.7 que sea expresable en RLS | RNF-401, §14 | ✅ |

### Bloque G — Autenticación y sesión

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| G1 | Estrategia `passport-oauth2` apuntada a GitHub, con `state` y PKCE | El flujo completo devuelve el perfil de GitHub | T-5, RNF-105 | ✅ |
| G2 | Alta: crear usuario, su workspace personal y aplicar invitaciones pendientes | Un usuario nuevo entra y ve su workspace vacío | RF-105, RF-106 | ✅ |
| G3 | Sesión opaca en base de datos, cookie firmada y caché en Redis | La cookie no contiene datos; el token se guarda hasheado | RF-107, §7 | ✅ |
| G4 | Contexto de petición: interceptor con AsyncLocalStorage y `set_config` | Cada consulta viaja con la identidad y la transacción la libera al terminar | §6.2 | ✅ |
| G5 | Guard global de autenticación y endpoint `/me` | Toda ruta salvo login y callbacks exige sesión | RF-109 | ✅ |
| G6 | Cierre de sesión y desactivación inmediata | Desactivar una cuenta corta el acceso al instante, sesiones incluidas | RF-108, RF-110 | ✅ |
| G7 | Administrador inicial por configuración | El usuario indicado recibe `ADMIN` al darse de alta | RF-111 | ✅ |
| G8 | Rate limiting con Redis en login y alta | Superar el límite responde 429 | RNF-109 | ✅ |

### Bloque J — API de workspaces e invitaciones

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| J1 | Listar workspaces propios e invitados, y renombrar el propio | El selector recibe el propio más aquellos donde soy miembro | RF-301..303 | ✅ |
| J2 | Invitar por email, listar pendientes y revocar | Invitar a alguien sin cuenta deja la invitación pendiente | RF-304..306 | ✅ |
| J3 | Miembros: listar, expulsar y abandonar | El dueño no puede abandonar el suyo; un invitado sí | RF-307, RF-308, RF-310 | ✅ |
| J4 | Invitar a ciegas: sin directorio ni confirmación de existencia | La respuesta es idéntica exista o no esa cuenta | RF-312 | ✅ |
| J5 | Auditoría de los eventos de esta fase | Cada alta, invitación, expulsión y cambio de rol queda registrado sin datos sensibles | RF-701, RF-706 | ✅ |

### Bloque I — Interfaz

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| I1 | Pantalla de entrada con GitHub y manejo del retorno | Entrar y salir funciona de principio a fin en el navegador | RF-101 | ✅ |
| I2 | Selector de workspace y estado de sesión en la cabecera | Se ve en cuál estás y puedes cambiar a los que te invitaron | RF-301, RF-302 | ✅ |
| I3 | Pantalla de miembros e invitaciones del workspace | Invitar, revocar y expulsar desde la interfaz | RF-304..308, RF-311 | ✅ |
| I4 | La interfaz de invitado no ofrece lo que no puede hacer | Un miembro no ve las acciones del dueño | RF-606 | ✅ |
| I5 | Estados vacíos y errores con sentido | Un workspace recién creado explica qué hacer a continuación | RF-610 | ✅ |

---

## H2 — Pensar solo

> Objetivo: que el producto sirva para lo que existe. Crear una app, escribir su visión, refinarla y ver
> cómo ha ido cambiando. Al terminar H2 una persona puede usar App Foundry de principio a fin **por su
> cuenta**; compartirlo con otros es lo que ya permitió H1 y lo que afinará H3.
>
> Alcance: el listado de apps entra, pero básico. Filtros, búsqueda y selector de iconos son H6. Los
> comentarios, con su anclaje al texto, son H4.

### Bloque K — Modelo de apps y documentos

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| K1 | Tablas `apps` y `app_tags` con sus índices | El esquema declarado coincide con el aplicado | §5.3, RF-403 | ✅ |
| K2 | Tablas `documents` y `document_versions`, con el contenido actual desnormalizado | Guardar una versión actualiza ambas en la misma transacción | §5.3, RF-505 | ✅ |
| K3 | Políticas RLS de apps según su nivel de acceso | Privada solo para su precursor; lectura y edición según corresponda | RF-405, §3.6 | ✅ |
| K4 | Políticas de documentos y versiones, heredadas de su app | Quien no ve la app no ve su historial | RNF-103 | ✅ |
| K5 | El nivel de acceso de una app creada por un invitado queda fijado | Ni su precursor ni el dueño del workspace pueden cambiarlo | RF-406, D-9 | ✅ |
| K6 | Herencia del rol de precursor al salir alguien del workspace | Sus apps se quedan y pasan al dueño, con la autoría del historial intacta | RF-413, D-10 | ✅ |
| K7 | Ampliar la suite de aislamiento a apps y documentos | Un test negativo por cada celda de la matriz §3.7 expresable en RLS | RNF-401 | ✅ |

### Bloque L — API de apps

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| L1 | Crear app con su visión inicial y su icono por defecto | Cualquier miembro del workspace puede crear; el icono es distinto del de sus vecinas | RF-401, RF-402, RF-415 | ✅ |
| L2 | Listar las apps visibles de un workspace | Un invitado no ve las privadas ajenas | RF-601 | ✅ |
| L3 | Ver y editar metadatos: nombre, descripción, estado, etiquetas, enlace al repositorio | El enlace a GitHub se valida en formato y no trae ningún dato | RF-403, RF-404, RF-417 | ✅ |
| L4 | Cambiar el nivel de acceso | Solo el precursor que además es dueño del workspace | RF-406 | ✅ |
| L5 | Archivar, desarchivar y eliminar | Archivada queda en solo lectura; eliminar exige confirmación explícita | RF-409, RF-410, RF-411 | ✅ |
| L6 | Transferir el rol de precursor | Recibirlo no otorga permiso para crear apps nuevas | RF-408 | ✅ |
| L7 | Auditoría de todo lo anterior | Cada acción queda registrada sin contenido de documentos | RF-701, RF-706 | ✅ |

### Bloque M — API del documento de visión

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| M1 | Leer el documento y guardar una versión nueva | Cada guardado explícito crea una versión inmutable con autor y mensaje | RF-501, RF-505 | ✅ |
| M2 | Detección de conflictos por versión base | Dos ediciones simultáneas: la segunda recibe 409 y no sobrescribe | RF-511 | ✅ |
| M3 | Historial de versiones con su autoría | Los contribuidores se derivan del historial, sin concederlos a nadie | RF-507, RF-509 | ✅ |
| M4 | Diferencias entre dos versiones cualesquiera | El diff es correcto en ambos sentidos | RF-508 | ✅ |
| M5 | Restaurar una versión anterior | Crea una versión nueva y no borra nada | RF-510 | ✅ |
| M6 | Exportar como `VISION.md` con su cabecera de metadatos | El fichero es identificable fuera de la plataforma | RF-512, T-18 | ✅ |
| M7 | Plantilla de visión para las apps nuevas | Una app recién creada arranca con sus secciones guía | RF-503 | ✅ |

### Bloque N — Editor e interfaz

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| N1 | Listado de apps del workspace, con su icono, estado y precursor | Se distingue de un vistazo qué es tuyo y qué está compartido | RF-601 | ✅ |
| N2 | Crear app desde la interfaz, en menos de un minuto | El botón de nueva app es el elemento más visible | RF-402, RF-605 | ✅ |
| N3 | Ficha de app: visión renderizada, metadatos, precursor y contribuidores | Todo en una pantalla | RF-607 | ✅ |
| N4 | Editor CodeMirror con previsualización y borrador local | Cerrar la pestaña a media edición no pierde el texto | RF-504, RF-506, T-7 | ✅ |
| N5 | Markdown saneado al renderizar | Un documento con HTML o scripts no ejecuta nada | RF-513 | ✅ |
| N6 | Historial con diferencias y restauración desde la interfaz | Comparar dos versiones y volver a una anterior | RF-507, RF-508, RF-510 | ✅ |
| N7 | Estados vacíos y aviso de conflicto con sentido | Un workspace sin apps orienta; un conflicto explica qué hacer | RF-610, RF-511 | ✅ |

---

## H3 — Pensar en equipo de verdad

> El plan original definía H3 como «niveles de acceso, miembros, permisos completos y suite de tests
> negativos», pero casi todo eso se adelantó: los niveles de acceso entraron en K y L, los permisos tienen 56
> tests y los miembros e invitaciones se hicieron en H1. Lo que queda es más pequeño y distinto, así que el
> hito se redefine en lugar de ejecutarse a ciegas.
>
> Objetivo: cerrar lo que impide usar el producto **entre varias personas** — la interfaz que falta, los tests
> de la API que aún no existen, y una prueba real con dos identidades.

### Bloque O — Editar una app desde la interfaz

> Hueco detectado al usar el producto: la API permite editar los siete campos de una app, pero la interfaz
> solo los enseña. Las etiquetas se ven en las tarjetas y no hay forma de ponerlas.

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| O1 | Editar nombre, descripción, estado y etiquetas | Se ponen y se quitan etiquetas, y aparecen en la tarjeta | RF-403, RF-404 | ✅ |
| O2 | Selector de icono: emoji y color de la paleta curada | Cambiar el icono se refleja en el listado | RF-416 | ✅ |
| O3 | Enlace al repositorio de GitHub | Se guarda, se muestra como enlace y rechaza lo que no sea una URL | RF-417 | ✅ |
| O4 | Cambiar el nivel de acceso, explicando qué implica | La interfaz dice a cuánta gente pasará a verse antes de confirmar | RF-406, RF-407 | ✅ |
| O5 | Archivar, desarchivar, transferir y eliminar | Eliminar exige escribir el nombre de la app | RF-409, RF-410, RF-411 | ✅ |
| O6 | La interfaz no ofrece lo que quien mira no puede hacer | Un invitado en una app de solo lectura no ve ningún control de edición | RF-606 | ✅ |

### Bloque P — Tests de la API

> Deuda declarada en H2: la detección de conflictos, que es la pieza más delicada escrita hasta ahora, se
> verificó a mano y no tiene test automatizado. `apps/api` no tiene todavía infraestructura de pruebas.

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| P1 | Infraestructura de tests de API contra un Postgres real | `pnpm test:api` arranca la aplicación y ejecuta peticiones reales | RNF-401 | ✅ |
| P2 | Tests del guardado y del conflicto de versiones | Dos guardados desde la misma versión base: el segundo recibe 409 y no sobrescribe | RF-511 | ✅ |
| P3 | Tests de permisos por endpoint, con dos identidades | Cada regla de la matriz §3.7 comprobada a través de HTTP, no solo en SQL | RNF-401 | ✅ |
| P4 | Tests de los caminos de error | 404 frente a 403 según lo acordado, y los rechazos del motor traducidos | RD-6 | ✅ |

### Bloque Q — Prueba del flujo compartido

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| Q1 | Datos de ejemplo con dos personas y un workspace compartido | `pnpm db:seed` deja el escenario listo para mirarlo en la interfaz | RNF-303 | ✅ |
| Q2 | Recorrido completo del flujo compartido con dos identidades | Invitar, ver, editar según nivel, y comprobar qué no se ve | §7 criterios 4 a 8 | ✅ |

---

## H4 — Conversar sobre el texto

> Objetivo: que refinar una visión deje de ser un monólogo. Un hilo general al
> pie y comentarios anclados a fragmentos concretos, al estilo de Confluence.
>
> Es la parte técnicamente más delicada del proyecto. El problema no es guardar
> comentarios: es que el texto al que se anclan **sigue cambiando**, y un
> comentario que pierde su sitio no puede ni desaparecer ni engancharse al
> fragmento equivocado (TRD §9).

### Bloque R — Modelo de comentarios

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| R1 | Tablas `comment_threads`, `comments` y `comment_mentions` | El esquema declarado coincide con el aplicado | §5.4 | ✅ |
| R2 | Anidamiento de un solo nivel, garantizado por la base de datos | Responder a una respuesta se rechaza en el motor, no solo en la interfaz | RF-804 | ✅ |
| R3 | Políticas: comenta quien puede leer, incluido `WORKSPACE_READ` | Un lector que no edita sí comenta | RF-803, D-12 | ✅ |
| R4 | Borrado lógico que conserva el hilo y la autoría | Expulsar a alguien no borra lo que escribió | RF-806, RF-813 | ✅ |
| R5 | Tests de aislamiento de los comentarios | Quien no ve la app no ve sus hilos | RNF-401 | ✅ |

### Bloque S — Anclaje y reanclaje

> Lógica pura, en `core` y con tests exhaustivos: es donde un error se traduce
> en comentarios pegados donde no tocan, y eso destruye la confianza en la
> herramienta más rápido que perderlos.

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| S1 | Modelo de ancla: cita, prefijo, sufijo y posición | Se captura de un fragmento y se vuelve a encontrar en el mismo texto | RF-808 | ✅ |
| S2 | Reanclaje por coincidencia exacta y por contexto | Editar el final del documento no mueve los anclajes de arriba | TRD §9.3 | ✅ |
| S3 | Reanclaje difuso ante ediciones menores | Corregir una errata dentro del fragmento no rompe su anclaje | TRD §9.3 | ✅ |
| S4 | Marcar como huérfano cuando el fragmento desaparece | Ante la duda, huérfano antes que anclado en el sitio equivocado | RF-809 | ✅ |
| S5 | Un ancla huérfana revive si el texto vuelve | Restaurar una versión anterior recupera sus anclajes | RF-809 | ✅ |

### Bloque T — API de comentarios

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| T1 | Hilo general: crear, responder, listar | Cualquiera que pueda leer la app comenta | RF-801, RF-803 | ✅ |
| T2 | Hilos inline anclados a una selección | Se guarda cita, contexto y versión de origen | RF-802, RF-808 | ✅ |
| T3 | Reanclaje al guardar una versión nueva | Se calcula una vez por edición, no una por visita | TRD §9.3 | ✅ |
| T4 | Editar y borrar comentarios propios; el precursor borra cualquier hilo | Un comentario editado se marca como tal | RF-806 | ✅ |
| T5 | Resolver y reabrir hilos, registrando quién | Los resueltos se ocultan por defecto y se recuperan | RF-807 | ✅ |
| T6 | Menciones limitadas a miembros del workspace | El autocompletado no revela usuarios de fuera | RF-814, RF-815 | ✅ |
| T7 | Tests de API de todo lo anterior | Incluidos los casos negativos de permisos | RNF-401 | ✅ |

### Bloque W — Interfaz de comentarios

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| W1 | Hilo general al pie de la visión | Comentar y responder sin salir de la lectura | RF-801 | ✅ |
| W2 | Seleccionar texto y comentar sobre la selección | La selección del navegador se traduce a posición en el markdown | RF-802, TRD §9.1 | ✅ |
| W3 | Panel lateral con los hilos y su estado | Activos, resueltos y huérfanos, con su cita original | RF-810 | ✅ |
| W4 | Resaltado del fragmento y navegación en ambos sentidos | Del hilo al texto y del texto al hilo | RF-810 | ✅ |
| W5 | Menciones con autocompletado | Escribir `@` ofrece solo miembros del workspace | RF-814 | ✅ |
| W6 | Contador de hilos abiertos en la ficha y el listado | Se ve dónde hay conversación pendiente | RF-811 | ✅ |

---

## H5 — Que nada se quede sin leer

> El objetivo no es «tener notificaciones», es que quien recibe un comentario se
> entere sin tener que ir a buscarlo. Eso obliga a resolver dos cosas incómodas:
> quién debe enterarse de cada acción, y cómo llega el aviso sin recargar.

### Bloque X — Modelo de notificaciones

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| X1 | Tabla `notifications` con destinatario, tipo, `payload` y referencias | Se renderiza una notificación sin consultar otras tablas | §5.5 | ✅ |
| X2 | Políticas: cada uno ve y purga las suyas, y nadie fabrica avisos ajenos | Crear un aviso para alguien de otro workspace se rechaza en el motor | RF-906, RF-312 | ✅ |
| X3 | Tests de aislamiento | Un usuario no ve ni borra las notificaciones de otro | RNF-401 | ✅ |

### Bloque Y — Quién se entera de qué

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| Y1 | Emisión en la misma transacción que la acción que la provoca | Si la acción se deshace, el aviso tampoco existe | §5.5 | ✅ |
| Y2 | Nadie recibe avisos de sus propios actos | Comentar en tu propia app no te notifica | RF-905 | ✅ |
| Y3 | Destinatarios por acción: comentario, respuesta, resolución, versión, invitación, traspaso, herencia | Cada caso avisa a quien le incumbe y a nadie más | RF-902 | ✅ |
| Y3b | Herencia de apps al salir alguien del workspace | Hecho en H7, bloque AG | RF-413 | ✅ |
| Y4 | Menciones: avisan aunque no participes, si eres del workspace | Mencionar a alguien de fuera no filtra que exista | RF-908, RF-815 | ✅ |

### Bloque Z — API y tiempo real

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| Z1 | Listado, marcar leídas y purgar (una y todas) | El contador de no leídas cuadra tras cada operación | RF-901, RF-903, RF-909 | ✅ |
| Z2 | SSE por usuario, publicado por Redis | Dos instancias no rompen el canal | §11, T-6 | ✅ |
| Z3 | Reconexión con `Last-Event-ID` y latidos | Cortar la red no pierde avisos ni deja la conexión colgada | §11 | ✅ |
| Z4 | Purga automática por antigüedad y por tope de usuario | No crecen sin límite y no tocan el contenido referenciado | RF-910, RF-911 | ✅ |
| Z5 | Tests de la API | Cubren permisos, contador y purga | RNF-401 | ✅ |

### Bloque AB — Interfaz

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AB1 | Campana con contador siempre visible | El contador sube sin recargar | RF-901 | ✅ |
| AB2 | Panel: leer, marcar leídas y purgar | Se vacían las leídas de una vez | RF-903, RF-909 | ✅ |
| AB3 | Pulsar lleva al recurso: app, hilo o workspace | Un aviso de comentario abre su hilo, resaltado | RF-904 | ✅ |
| AB4 | Trazas de Redis visibles en Tempo | Comprobado: los spans se llaman como el comando (`publish`, `get`), no «redis» | §13 | ✅ |

## H6 — Encontrar las cosas

> Hasta ahora todo se ha visto porque cabía en una pantalla. Con cien apps y
> varios workspaces eso deja de ser cierto, y lo que decide si la herramienta
> sirve es si puedes volver a algo que escribiste hace tres meses.

### Bloque AC — Búsqueda en el servidor

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AC1 | Columna de búsqueda mantenida por la propia base de datos | Editar la visión actualiza lo que se busca, sin que nadie lo recuerde | TRD §10, T-10 | ✅ |
| AC2 | Buscar por nombre, descripción y contenido, en todos tus workspaces | Un resultado dice de qué workspace viene | RF-604 | ✅ |
| AC3 | La búsqueda no enseña lo que no podrías abrir | Una app privada ajena no aparece ni buscándola por su nombre exacto | RF-604, RNF-401 | ✅ |

### Bloque AD — Listado: filtrar, ordenar, paginar

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AD1 | Filtros por estado, etiqueta y nivel de acceso | Combinarlos acota, no se estorban entre sí | RF-602 | ✅ |
| AD2 | Orden por actividad y por nombre | El orden por defecto sigue siendo lo más reciente | RF-603 | ✅ |
| AD3 | Paginación | Cientos de apps no se traen de una vez | RF-603, RNF-201 | ✅ |
| AD4 | Tests del listado | Filtros, orden y páginas cuadran | RNF-401 | ✅ |

### Bloque AE — Encontrar desde la interfaz

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AE1 | Buscador global, con el workspace de cada resultado | Buscar algo de otro workspace lleva hasta ahí | RF-604 | ✅ |
| AE2 | Filtros y orden en el listado | Lo elegido sobrevive a recargar | RF-602, RF-603 | ✅ |
| AE3 | Estados vacíos que dicen qué hacer | Sin resultados no es una pantalla en blanco | RF-610 | ✅ |

### Bloque AF — Rematar la interfaz

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AF1 | Tema claro y oscuro, respetando el del sistema | Cambiarlo no parpadea ni se olvida al recargar | RF-609 | ✅ |
| AF2 | Atajos para lo frecuente: buscar, nueva app, guardar | Se descubren solos y no pisan los del navegador | RF-611 | ✅ |
| AF3 | Ser invitado se nota antes de escribir, no después | En un workspace ajeno se advierte de que lo creado será de todos | RF-606 | ✅ |

## H7 — Cerrar la v1

> Lo que queda no se ve al usar el producto un rato, pero es lo que separa algo
> que funciona en el portátil de algo que se puede poner en marcha: qué pasa
> cuando alguien se va, quién manda en la instancia, qué quedó registrado, y
> cómo se despliega y se mira cuando falla.

### Bloque AG — Cuando alguien se va (venía de H5)

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AG1 | Las apps de quien se marcha pasan al dueño del workspace | Salir no deja apps con un precursor que ya no está | RF-413 | ✅ |
| AG2 | Queda registrado y se avisa a quien las hereda | Aparece en auditoría y llega el aviso | RF-413, RF-902 | ✅ |
| AG3 | Avisar antes de salir de que las apps se quedan | Nadie se marcha sin saberlo | RF-308 | ✅ |

### Bloque AH — Administración de la instancia

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AH1 | Listar usuarios con su rol, estado y actividad | Solo lo ve un administrador | RF-201 | ✅ |
| AH2 | Cambiar rol y desactivar cuentas | La instancia nunca se queda sin administrador activo | RF-202, RF-203 | ✅ |
| AH3 | Desactivar cierra el paso de verdad | Las sesiones abiertas dejan de valer | RF-203 | ✅ |
| AH4 | Métricas agregadas de la instancia | Sin asomarse al contenido de nadie | RF-204 | ✅ |

### Bloque AI — Auditoría consultable

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AI1 | Un administrador consulta los eventos de plataforma | Filtra por persona y por fecha, y no ve contenido | RF-703, RF-706 | ✅ |
| AI2 | El dueño de un workspace consulta lo suyo | Y solo lo suyo | RF-704 | ✅ |
| AI3 | Interfaz de ambas cosas | Se entiende qué pasó sin leer identificadores | RF-703, RF-704 | ✅ |

### Bloque AJ — Poner esto en marcha

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AJ1 | Imágenes de la API y de la interfaz | Se levanta entero desde cero con un comando | TRD §16 | ✅ |
| AJ2 | Paneles de Grafana | Las métricas que importan están a la vista | TRD §13 | ✅ |
| AJ3 | Un recorrido completo automatizado | Entrar, crear, escribir, comentar y encontrar | RNF-401 | ✅ |

## H8 — Guardar no es publicar

> Guardar creaba una versión, así que el historial acumulaba una entrada por cada vez que alguien tocaba una
> coma y no había forma de decir «esto ya está». Se separan los dos actos: guardar toca la copia de trabajo,
> commitear crea la versión y le pone nombre. Con ello los comentarios pasan a pertenecer a la versión sobre
> la que se escribieron, que es lo que les da sentido: un comentario habla de un texto concreto.

### Bloque AK — Copia de trabajo, commits y descartes

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AK1 | La copia de trabajo se separa de la versión, con su revisión | Guardar dos veces deja una sola versión y dos revisiones | RF-505 | ✅ |
| AK2 | Commitear con mensaje obligatorio de hasta 100 caracteres | Sin mensaje no hay versión; sin cambios tampoco | RF-505 | ✅ |
| AK3 | Descartar los cambios sin commitear | La copia de trabajo vuelve a la versión y queda en auditoría | RF-515 | ✅ |
| AK4 | Conflictos por revisión, no por versión base | Dos guardados seguidos sobre la misma versión no se pisan | RF-511 | ✅ |
| AK5 | Coautoría de quien guarda sin commitear | Quien escribe y no commitea sigue siendo contribuidor | RF-509, RF-516 | ✅ |
| AK6 | Restaurar deja los cambios sin commitear | Se puede revisar, seguir editando y ponerle mensaje | RF-510 | ✅ |

### Bloque AL — Comentarios de su versión

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AL1 | Cada hilo inline pertenece a su versión y solo se ve en ella | Commitear no arrastra la conversación a la versión nueva | RF-808, RF-817 | ✅ |
| AL2 | No se comenta sobre versiones que no son la actual | El menú de selección no aparece en una versión pasada | RF-817 | ✅ |
| AL3 | Los abiertos de versiones anteriores se resuelven y se anuncian | Desde la versión actual se ve cuántos quedan y se llega a ellos | RF-807, RF-817 | ✅ |
| AL4 | El ancla de la versión es inmutable; la de la copia de trabajo se recalcula | Descartar devuelve todos los hilos a su sitio | RF-808, RF-809 | ✅ |

### Bloque AM — Guardar, commitear y descartar desde la interfaz

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AM1 | La copia de trabajo aparece en el desplegable de versiones | Se distingue de un vistazo si hay cambios sin commitear | RF-507 | ✅ |
| AM2 | Commit y descarte a la derecha de la fila de guardar | Commitear pide mensaje; descartar avisa y se puede cancelar | RF-505, RF-515 | ✅ |
| AM3 | El panel de comentarios sigue a la versión que se mira | Al elegir una versión pasada se ven sus hilos, no los de hoy | RF-817 | ✅ |

### Bloque AN — Cerrar la v1

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AN1 | Recorrido de extremo a extremo con dos identidades | Invitar, editar como invitada y ver el historial a nombre de quien escribió | RNF-402 | ✅ |
| AN2 | Entrar aterriza en el workspace propio, no en el que ordene antes | Una invitada entra en el suyo aunque el ajeno se llame antes | RF-301 | ✅ |

## Decisiones tomadas sobre requisitos

| Requisito | Decisión |
|---|---|
| RF-608 · Responsive | **Verificado y automatizado.** Sin desbordamiento horizontal a 1440, 1280, 1024 ni 768. El móvil a 390 se salía treinta píxeles por la cabecera y se ha arreglado, aunque el requisito lo marque como deseable. La prueba se queda en el repositorio, exigiendo solo los anchos que el requisito exige y avisando del móvil sin tumbar nada. |
| RF-207 · Baja de cuenta | **Resuelta como baja reversible.** Apaga la cuenta y arranca el plazo de gracia; volver a entrar dentro de él la reactiva sola. Se distingue de una suspensión por quién la apagó: de la propia no hace falta pedir permiso para volver, de la ajena sí, o suspender no serviría de nada. El borrado definitivo sigue siendo cosa de un administrador. |
| RF-414 · Apps de un dueño desactivado | **Resuelto con periodo de gracia.** Su workspace personal deja de abrirse mientras la cuenta esté parada, y vuelve sola al reactivarla; las apps que sostenía en workspaces ajenos pasan a su dueño en el acto, porque esconderlas castigaría a un equipo entero por la suspensión de una persona. Queda apuntada la fecha para contar los noventa días. Qué hacer al vencer el plazo con las de su propio workspace, cuando no hay a quién dárselas, sigue sin decidir. |
| Editar sobre el resultado (WYSIWYG) | **Descartado por ahora.** Obligaría a convertir markdown → documento → markdown en cada guardado, y esa vuelta normaliza el texto: el historial se llenaría de diffs que nadie hizo y el reanclaje recalcularía sobre un texto cambiado solo. La vía viable, si se retoma, es editar bloque a bloque usando los rangos de origen que ya lleva cada elemento renderizado. |
| RF-605 · «Nueva app» como acción más visible | **Se cumple sin el botón.** El campo para crear está siempre puesto y es lo primero bajo la cabecera, así que la acción es más visible que antes, aunque ya no exista un botón con ese nombre. |
| RNF-402 · Recorrido de extremo a extremo | **Cubierto con dos identidades.** El recorrido completo —invitar, editar como invitada y ver el historial— corre con dos sesiones a la vez, que es donde falla lo de trabajar en equipo: lo que ve la invitada, lo que puede tocar y a nombre de quién queda. Cazó de paso que entrar aterrizaba en el workspace ajeno si su nombre ordenaba antes. |
| RF-206 · Editar nombre visible y avatar | **No se implementa.** Todo el perfil se hereda de GitHub y se actualiza al entrar; mantener una copia editable obligaría a decidir cuál manda cada vez que cambie allí (RF-208). La página de cuenta los muestra, en solo lectura. |

## Mejoras detectadas usando el producto

> No salen de un hito: salen de abrir la aplicación y encontrarse con algo que
> chirría. Se registran aquí para que quede claro de dónde vienen.

| # | Mejora | Origen | Estado |
|---|---|---|---|
| U1 | Separar estado, visibilidad y etiquetas, que se dibujaban como píldoras idénticas | El estado merece color propio y posición prominente | ✅ |
| U2 | Que cada tarjeta ocupe su altura y se empaqueten sin huecos | Una tarjeta alta estiraba a su vecina y dejaba espacio muerto | ✅ |
| U3 | Editar los metadatos de una app desde la interfaz | La API lo permitía y la interfaz solo los enseñaba | ✅ |
| U4 | Ajustes de workspace: nombre, icono y fondo | Un workspace no se podía distinguir de otro de un vistazo | ✅ |
| U5 | Menú al seleccionar texto, en vez de abrir el formulario solo | Seleccionar texto no es decidir comentarlo | ✅ |
| U6 | Resaltar en amarillo todos los fragmentos con conversación | La conversación era invisible hasta abrir el panel | ✅ |
| U7 | Panel compacto: responder bajo demanda | Las cajas de respuesta abiertas forzaban scroll enseguida | ✅ |
| U8 | El botón de comentar: debajo de la selección, más pequeño y sin perder el contexto | Tapaba el texto marcado y el resaltado se apagaba al escribir | ✅ |
| U9 | Los hilos resueltos dejan de subrayarse; el resaltado se repinta solo | Reaparecían al comentar y se apagaban al tocar el panel | ✅ |
| U10 | Ruta completa en la cabecera y salto directo entre apps | El breadcrumb se cortaba en el workspace y cambiar de app obligaba a volver atrás | ✅ |
| U11 | El atajo de guardar rompía la ficha al abrir una app desde cero | Hook declarado tras una salida anticipada; solo se veía sin caché, lo cazó el recorrido | ✅ |
| U12 | Menú de cuenta y página de ajustes personales | El selector de tema ocupaba sitio permanente en la cabecera para algo que se toca una vez | ✅ |
| U13 | Ruta plana con marca propia, y salida de los ajustes | Los emojis y los pesos distintos competían en una línea que solo dice dónde estás | ✅ |
| U14 | El campo para crear una app, siempre puesto | Crear empezaba por desplegar un formulario que solo prometía otro campo | ✅ |
| U15 | El fuego de la forja en la pantalla de entrada | La primera pantalla no decía nada de lo que es esto | ✅ |
| U16 | El fondo del workspace pasa a la página, y fuera la tarjeta de cabecera | El nombre estaba dos veces y el fondo se limitaba a una tarjeta | ✅ |
| U17 | Una sola pestaña VISION.md con dos interruptores, y texto plano con números de línea | Leer y escribir eran dos sitios distintos para el mismo documento | ✅ |
| U18 | Los controles sobre la caja, y la conversación al lado también en texto plano | Los controles estaban lejos de lo que gobiernan y el texto crudo perdía el contexto | ✅ |
| U19 | Los metadatos de la app, en la línea del título | Tres líneas de cabecera para datos que se miran una vez al llegar | ✅ |
| U20 | Conversación plegable, hilos opacos, descarga junto a los controles y etiquetas con forma | Escribir a media pantalla incomoda, y lo transparente se teñía con el fondo del workspace | ✅ |
| U21 | Un solo interruptor y IBM Plex Mono en el editor | Dos interruptores para decidir una cosa | ✅ |
| U22 | El historial, en un desplegable sobre el documento | La pestaña obligaba a salir del texto para mirar su propia historia | ✅ |
| U23 | Guardar dejó de crear versión; commitear la crea y le pone nombre | El historial acumulaba una entrada por cada coma | ✅ |
| U24 | El resaltado también se pinta al mirar una versión anterior | La caja de la versión no llevaba el `ref` y el pintado limpiaba en vez de dibujar | ✅ |
| U25 | Entrar aterriza en el workspace propio | `isPersonal` marca el de su dueño, no el tuyo: una invitada podía entrar en casa ajena. Lo cazó el recorrido con dos identidades | ✅ |
| U26 | El menú flotante, bajo la selección y a su derecha, no donde quedó el puntero | Se posiciona con el ratón: arrastrar deprisa lo deja lejos, y arrastrar hacia la izquierda lo deja al principio | ✅ |
| U27 | Detectar la selección por el cambio de selección, y resolver también los bloques enteros | Doble clic, triple clic, teclado y títulos no ofrecían menú: el disparador era `mouseup` y el rastro de posición se buscaba desde el contenedor común | ✅ |

> U26 y U27 son requisito de la v2 (RF-1414..1416): el asistente de escritura cuelga de ese mismo menú, así
> que dejan de ser una molestia al comentar y pasan a inutilizar media función nueva. Se arreglan en **H10**.

---

## Hitos siguientes (a grano grueso)

Se desglosarán al cerrar el hito anterior.

| Hito   | Contenido                                                                                  | Deja usable                   |
| ------ | ------------------------------------------------------------------------------------------ | ----------------------------- |
| **H2** | Apps, documento de visión, versiones, historial, diff, restaurar, editor CodeMirror        | **Pensar solo**               |
| **H3** | Niveles de acceso, miembros, permisos completos y suite de tests negativos                 | **Pensar en equipo**          |
| **H4** | Comentarios: hilo general, inline con anclaje y reanclaje, resolver y reabrir, menciones   | Conversar sobre el texto      |
| **H5** ✅ | Notificaciones, SSE, purga                                                                 | Que nada se quede sin leer    |
| **H6** ✅ | Búsqueda, filtros, iconos, tema, estados vacíos, atajos                                    | La UI atractiva de O7         |
| **H7** ✅ | Admin, auditoría, Playwright, paneles de Grafana, Dockerfiles                              | v1 completa                   |
| **H8** ✅ | Guardar deja de versionar: copia de trabajo, commits con mensaje y comentarios por versión  | Un historial que se puede leer |

---

## v2 — Pensar acompañado

Documentos origen: [REQUIREMENTS-v2.md](./REQUIREMENTS-v2.md) · [TRD-v2.md](./TRD-v2.md). Se desglosarán al
empezar cada hito, con el mismo método que la v1.

| Hito    | Contenido                                                                                     | Deja usable                        |
| ------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| **H9** ✅  | Puerto y adaptadores, cifrado de credenciales, catálogo por API, modelo por tarea, cupos       | La IA ya tiene grifo y contador    |
| **H10** ✅ | Arreglo del menú de selección (U26, U27) y asistente de escritura, con diff que se acepta      | **Primer valor real**              |
| **H11** ✅ | Generación de ideas, con y sin búsqueda web, y la app creada con su visión sembrada            | Cierra «no tengo ideas»            |
| **H12**    | Agentes: modelo, catálogo de fábrica, instancias, autoría polimórfica, menciones y respuestas  | Un interlocutor con perfil         |
| **H13**    | Revisión en abanico: cola, estimación, confirmación, cancelación y cortafuegos                 | **Pensar acompañado, completo**    |
| **H14**    | Panel de Grafana, recorrido de extremo a extremo, conciliación de cupos y cierre               | v2 completa                        |

Solo se desglosa el hito en curso. H9, H10 y H11 están cerradas; **H12** está desglosada abajo.

---

## H9 — La IA tiene grifo y contador

> Objetivo: que exista una forma de hablar con un modelo y que **ninguna llamada pueda escaparse sin
> credencial, sin cupo y sin registro**. No entrega nada visible salvo los ajustes del workspace, y es
> deliberado: cualquier función de IA construida antes de esto nacería sin techo, y añadírselo después es
> reescribirla (RD-10).
>
> Alcance: el asistente de escritura es H10; ideas, H11; agentes, H12 y H13. Aquí solo el grifo, el contador
> y las dos primeras implementaciones del contrato.

### Bloque AO — El contrato de proveedor

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AO1 | Puerto `LlmProvider`, capacidades, tipos de tarea y de petición en `core` | `core` no importa ningún SDK de proveedor, y el linter lo impide | T-21, T-22, RD-8 | ✅ |
| AO2 | Taxonomía de errores y política de reintento asociada a cada `kind` | Un `AUTH` no se reintenta nunca; un `TRANSIENT` sí | §5.3, RNF-703 | ✅ |
| AO3 | Proveedor de mentira que implementa el puerto | Streaming simulado, cada `kind` de error y conteos deterministas, sin red | T-36, RNF-901 | ✅ |
| AO4 | Registro de proveedores y resolución por `ProviderId` | Añadir un proveedor es registrar un adaptador, sin tocar dominio ni interfaz | RD-8, O12 | ✅ |
| AO5 | Esquemas del producto en el subconjunto estricto | Un test rechaza cualquier esquema con campos opcionales o `additionalProperties` abierto | T-24 | ✅ |
| AO6 | Adaptador de Anthropic: texto, objeto con esquema, búsqueda web y conteo exacto | Contra el SDK oficial; el error de búsqueda que llega con HTTP 200 se traduce a la taxonomía | T-23, §6 | ✅ |
| AO7 | Adaptador de Groq: texto, objeto con decodificación restringida y aproximación de tokens | El mismo esquema del producto vale sin traducción; la aproximación redondea siempre al alza | T-23, T-24, §10 | ✅ |

### Bloque AP — Credenciales y proveedores del workspace

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AP1 | Tablas `workspace_ai_providers` y `workspace_ai_credentials` | El esquema declarado coincide con el aplicado | §7.1, RF-1001 | ✅ |
| AP2 | Cifrado AES-256-GCM con clave versionada y datos autenticados | Mover una fila cifrada a otro workspace la vuelve indescifrable | T-26, RNF-601 | ✅ |
| AP3 | Función `SECURITY DEFINER` y `SELECT` revocado sobre la credencial | El rol de aplicación no puede leer la tabla directamente | T-27, RNF-603 | ✅ |
| AP4 | Políticas RLS de las tablas nuevas y ampliación de la suite de aislamiento | Un miembro que no es dueño no lee la credencial de su propio workspace | RNF-603, RNF-904 | ✅ |
| AP5 | API de configurar, verificar, desactivar y borrar un proveedor | Una clave inválida se rechaza en el acto y con motivo; el proveedor no queda activo | RF-1002..1006 | ✅ |
| AP6 | Advertencia de envío a terceros, con registro de quién la aceptó | Activar el primer proveedor exige aceptarla | RF-1011 | ✅ |
| AP7 | Interruptor general de IA del workspace | Apagarla no borra configuración ni agentes; volver a encenderla lo restituye | RF-1012 | ✅ |
| AP8 | Auditoría de todo lo anterior | Ni una credencial, ni un fragmento de contenido, en ninguna entrada | RF-1702, RF-1703 | ✅ |
| AP9 | Rotación de la clave de instancia y recifrado en lote | Con dos claves activas se descifra lo viejo y se cifra con la nueva | T-26 | ✅ |

### Bloque AQ — Catálogo de modelos y asignación por tarea

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AQ1 | Tabla `ai_models` y lectura del catálogo desde la API del proveedor | Ventana de contexto y capacidades salen del proveedor, no de una constante | T-28, RF-1007 | ✅ |
| AQ2 | Caché con refresco en segundo plano y último catálogo conocido | Con el proveedor caído se sigue sirviendo lo último que se supo | RF-1009 | ✅ |
| AQ3 | Tabla `workspace_task_models` y API de asignación por tarea | Solo el dueño asigna; el resto consume lo asignado | RF-1101, RF-1102, RF-1107 | ✅ |
| AQ4 | Asignación por defecto propuesta al configurar el primer proveedor | Editable siempre; con un solo proveedor, todas las tareas van a él | RF-1103 | ✅ |
| AQ5 | Aviso cuando el modelo asignado desaparece del catálogo | Se avisa al dueño, no se falla cuando alguien usa la función | RF-1009 | ✅ |
| AQ6 | Rechazo por ventana de contexto insuficiente | Se explica qué pasa y qué hacer; nunca se recorta el documento en silencio | RF-1106 | ✅ |

### Bloque AR — Consumo y cupos

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AR1 | Tabla `ai_invocations` con sus índices | Entrada y salida separadas; ni una línea de contenido | RF-1201, RF-1202, T-29 | ✅ |
| AR2 | Contador en Redis con script Lua: reserva atómica y liquidación | Cinco reservas simultáneas no se saltan el cupo entre todas | T-30, §9.2 | ✅ |
| AR3 | Reconstrucción del contador desde el registro, y fallo cerrado sin Redis | Borrando la clave, el consumo del mes vuelve a salir correcto | §9.3, T-31 | ✅ |
| AR4 | Barrido de reservas huérfanas | Una reserva sin liquidar deja de comer cupo al vencer | §9.2 | ✅ |
| AR5 | Conciliación periódica del contador contra el registro | Una liquidación perdida se corrige sola en la siguiente pasada | §9.3 | ✅ |
| AR6 | Cupo mensual por proveedor y corte al agotarse | Agotado uno, las tareas del otro proveedor siguen funcionando | RF-1204, RF-1210 | ✅ |
| AR7 | Aviso al superar el umbral configurable | Notificación dentro de la aplicación al dueño | RF-1205 | ✅ |
| AR8 | Límite de invocaciones por miembro y ventana | Acota el ritmo, no el volumen: son cosas distintas | RF-1206 | ✅ |
| AR9 | Estimación previa como techo: entrada contada y salida al máximo | La cifra enseñada nunca se queda por debajo del consumo real | RF-1207, §10 | ✅ |
| AR10 | API de consumo del workspace | Cada miembro ve el suyo; el dueño, todo | RF-1208 | ✅ |
| AR11 | Suite de cupos | Concurrencia, reconstrucción, corte y fallo cerrado, con casos negativos | RNF-903 | ✅ |

### Bloque AS — Ajustes del workspace

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AS1 | Página de proveedores: alta, verificación, estado y credencial enmascarada | La clave no viaja al cliente ni entera ni descifrable | RF-1002, RF-1004 | ✅ |
| AS2 | Asignación de modelo por tarea desde la interfaz | Se dibuja a partir de las capacidades declaradas, no de una lista fija | RF-1008, RF-1102 | ✅ |
| AS3 | Cupos y umbral de aviso | Un cupo por proveedor configurado | RF-1204, RF-1205 | ✅ |
| AS4 | Página de consumo del mes | Desglose por proveedor, tarea, modelo y miembro, con entrada y salida separadas | RF-1208 | ✅ |
| AS5 | Sin proveedor activo, ninguna función de IA aparece | Ni botones deshabilitados, ni código de IA descargado | RF-1010 | ✅ |

### Bloque AT — Observabilidad

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AT1 | Traza por invocación, hija de quien la originó | Con proveedor, modelo, tarea, tokens y latencias; nunca contenido | RNF-801 | ✅ |
| AT2 | Métricas de invocaciones, tokens, consumo frente al cupo y errores | Visibles en Prometheus con las etiquetas acordadas | RNF-802 | ✅ |
| AT3 | Panel de Grafana de la IA | Junto a los que ya existen, sin tocarlos | RNF-803 | ✅ |
| AT4 | Cupo agotado y cortacircuitos, como eventos observables | No solo un mensaje en la interfaz | RNF-804 | ✅ |

> **Sobre AT4.** El corte por cupo se emite como métrica y se ve en el panel. El cortacircuitos tenía su
> métrica puesta pero no lo abría nadie, porque el cortacircuitos en sí vive en la ejecución de invocaciones
> (§11 del TRD v2). **Cerrado en AV5**: lo abre y lo cierra el paso común de invocación, y hay prueba de que un
> proveedor que falla sin parar deja de intentarse.

> **Sobre AQ6.** La regla vive en `core` con sus pruebas, y el punto por el que pasa toda invocación está
> escrito y en uso desde el primer caso de uso. En H9 no había ninguna ruta que invocara, así que lo demostrado
> era la regla y no su aplicación. **Cerrado en AV4**: un documento que no cabe se rechaza antes de llamar a
> nadie, diciendo cuántos tokens sobran. `assertFits` ha desaparecido por el camino —contar y comprobar son
> ahora un mismo paso, el que elige entre variantes— para no dejar dos formas de hacer lo mismo.

---

## H10 — Primer valor real: ayudar a escribir

> Objetivo: que seleccionar un párrafo flojo y pedir concretarlo devuelva algo que se puede aceptar o
> descartar. Es la primera función de la v2 que se toca, la más usada a diario y la más barata de construir
> sobre H9; y valida el contrato con tráfico real antes de que lleguen los agentes.
>
> Alcance: solo el asistente. Generar ideas es H11 y los agentes, H12 y H13. Aquí también se saldan los cuatro
> arreglos del menú de selección, porque el asistente cuelga de ese mismo menú.

### Bloque AU — El menú de selección

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AU1 | Posicionar el menú con la geometría de la selección, no con el puntero | Bajo su última línea y a su derecha, arrastrando en cualquier dirección | RF-1414, U26 | ✅ |
| AU2 | Detectar la selección al terminar el gesto, no mientras se hace | Doble clic, triple clic y teclado abren el menú | RF-1415, U27 | ✅ |
| AU3 | Resolver también los bloques enteros, y bajar el mínimo a dos caracteres | Un título seleccionado entero ofrece menú | RF-1416, U27 | ✅ |
| AU4 | Recorrido del menú de extremo a extremo | Los cuatro gestos, y que arrastrar no descoloque la selección | RNF-905 | ✅ |
| AU5 | Seleccionar más de una línea | Un párrafo escrito en dos líneas del fuente, y una selección que cruza de un párrafo al siguiente | RF-1416, U27 | ✅ |

> **Sobre AU2 y AU5.** El enunciado original de AU2 decía «por su cambio»; escuchar `selectionchange` resultó ser
> justo lo que volvía errática la selección —se dispara en cada fotograma del arrastre—, así que se escucha el final
> del gesto y el enunciado se ha corregido para que diga lo que el código hace.
>
> AU5 salió de usarlo: seleccionar más de una línea seguía sin ofrecer menú. Eran tres cosas distintas y ninguna era
> la que parecía. Un párrafo se escribe repartido en varias líneas del fuente —la plantilla de la visión lo está— y
> el navegador enseña ese salto como un espacio, así que el texto marcado no aparecía en su propio bloque; la cita
> se busca ahora sin exigir que los espacios coincidan, y bloque a bloque, que de paso permite cruzar de un párrafo
> al siguiente. Además el navegador termina la selección **fuera** del documento más a menudo de lo que parece —el
> triple clic sobre el último párrafo la lleva hasta el botón de abajo—, y exigir que el rango entero cayera dentro
> rechazaba selecciones perfectamente válidas: ahora se recorta. Y se mira un turno después del evento, porque
> durante `pointerup` la selección todavía es la de antes y el menú se quedaba puesto al pulsar fuera para quitarla.

### Bloque AV — El asistente por dentro

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AV1 | Ruta de asistencia en streaming sobre la copia de trabajo | El texto llega por partes y muere con la petición | RF-1401, RNF-701 | ✅ |
| AV2 | Las cinco acciones fijas, con su prompt | Mejorar, concretar, resumir, expandir y corregir; sin instrucción libre | RF-1402 | ✅ |
| AV3 | El contexto que se envía: la selección y el documento si cabe | Si no cabe, solo su entorno, y se dice | RF-1409 | ✅ |
| AV4 | Rechazo por ventana de contexto, aplicado de verdad | Un documento que no cabe se rechaza explicando cuánto sobra | RF-1106, AQ6 | ✅ |
| AV5 | Reintentos y cortacircuitos por proveedor | Un `AUTH` no se reintenta; un proveedor que falla sin parar deja de intentarse | RNF-703, RNF-704 | ✅ |
| AV6 | Cancelar corta la llamada al proveedor | Cerrar la petición aborta de verdad, no solo deja de escuchar | RNF-702 | ✅ |
| AV7 | Permisos: edición, y solo sobre la copia de trabajo | Con lectura no aparece; sobre una versión anterior no se puede | RF-1406, RF-1410 | ✅ |
| AV8 | El razonamiento de los modelos que piensan en voz alta, fuera del texto | `<think>…</think>` viaja aparte y nunca entra en el documento | RF-1403, RD-9 | ✅ |

> **Sobre AV5 y AV6.** El reintento **solo ocurre antes de la primera palabra**. Después de haber enviado texto,
> repetir la llamada volvería a escribir la propuesta desde el principio delante de quien la está leyendo: es la
> diferencia entre reintentar una llamada y reintentar una conversación ya empezada, y no hay forma de reanudar
> un flujo por la mitad.
>
> Y cancelar escucha el cierre de la **respuesta**, no el de la petición. Parecen lo mismo: la petición es un
> POST con su cuerpo ya recibido, así que Node la da por terminada mucho antes y no vuelve a avisar de nada.
> Escuchando el otro, cancelar no cancelaba: la generación seguía hasta el final gastando cuota para nadie. Se
> vio porque el test lo comprobaba contra el registro y no contra la pantalla.
>
> Lo consumido al cancelar se **aproxima**: el proveedor no llega a decir cuánto gastó, así que se registra la
> entrada contada más una estimación al alza de lo generado. Es mentira registrar cero, y quedarse corto es
> regalar cupo ajeno.

> **Sobre AV8.** Salió de usarlo con Groq: `qwen3.6` escribe su deliberación en el mismo flujo, envuelta en
> `<think>…</think>`, y aparecía en el diff —o sea, a un clic de entrar en el `VISION.md`—. Se separa **en el
> servidor** y no al pintarlo: lo que se acepta se escribe en el documento, así que dejar la limpieza para la
> interfaz habría dejado desprotegido a cualquier otro consumidor —un agente escribiendo un comentario, el MCP de
> la v3—. El separador es incremental porque la etiqueta se parte por donde quiera entre dos trozos del flujo, y
> retiene el final de cada trozo mientras pueda ser el principio de una: sin eso, un documento que acabe en «<»
> perdería ese carácter. Un bloque que se queda sin cerrar —el modelo se quedó sin tokens pensando— cuenta entero
> como razonamiento: darlo por respuesta metería la deliberación completa en el documento.
>
> El razonamiento se guarda y se enseña plegado en vez de tirarse: entender por qué el modelo propuso lo que
> propuso es a veces más útil que la propuesta. Y lo generado pensando se registra como consumido, porque pensar
> también se paga.

### Bloque AW — El asistente en la interfaz

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AW1 | Las acciones de IA en el menú de selección, junto a comentar | Un solo menú para dos cosas que se hacen sobre lo mismo | RF-1401 | ✅ |
| AW2 | El resultado llega en streaming y se pinta como diff | Se puede descartar sin esperar al final | RF-1403, RF-1407 | ✅ |
| AW3 | Aceptar aplica a la copia de trabajo; descartar no deja rastro | Con la misma comprobación de concurrencia que un guardado | RF-1404, RF-1408 | ✅ |
| AW4 | Acciones sobre el documento entero, con su techo de tokens a la vista | Mismo diff, mismas reglas; solo cambia el alcance | RF-1411, RF-1412 | ✅ |
| AW5 | Sin disponibilidad, ninguna acción aparece | Ni con la IA apagada, ni sin modelo asignado | RF-1010 | ✅ |
| AW6 | El razonamiento, en una sección plegada aparte de la propuesta | Se puede consultar, y no forma parte de lo que se acepta | RF-1403 | ✅ |

> **Sobre AW4.** El techo se pide a una ruta propia —`POST /apps/:id/document/assist/estimate`—, que cuenta de
> verdad contra el proveedor y comprueba que cabe, y ahí se para: ni traza, ni reserva de cupo, ni llamada a
> ningún modelo. Cuesta un recuento; es el precio de que la cifra sea un techo y no una aproximación de la que
> luego haya que disculparse. Lo que esa ruta rechaza es exactamente lo que habría rechazado la petición.
>
> **Sobre AW3, y un fallo que encontró el recorrido.** Aceptar guarda con la revisión **desde la que se pidió**,
> no con la de ahora: es lo que hace que un guardado ajeno a mitad de generación se rechace en vez de pisarlo.
> Escribiendo esa prueba salió otro fallo que no era del test: al aceptar se retiraba «la propuesta actual», y
> como guardar tarda, entre aceptar y la respuesta del servidor da tiempo a pedir otra —que desaparecía sola de
> la pantalla—. Ahora se retira **esa** propuesta y no la que haya. Y mientras se guarda no se ofrecen acciones
> de IA: la revisión que se enviaría es la de antes, así que la petición se rechazaría por concurrencia consigo
> misma.

### Bloque AX — Cerrar H10

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AX1 | Recorrido completo con el proveedor de mentira | Seleccionar, pedir, ver el diff, descartar y aceptar | RNF-905 | ✅ |
| AX2 | Comprobar la observabilidad con tráfico de verdad | Las trazas cuelgan de su petición y el panel deja de estar plano | RNF-801, AT4 | ✅ |

> **Sobre AX1.** El recorrido va contra el proveedor de mentira, que se activa desde la propia configuración de
> Playwright: sin eso, el asistente llamaría a un modelo de verdad y gastaría la cuota —y el dinero— de quien
> ejecute los tests. Una salvedad honesta: el paso de «descartar a media respuesta» descarta cuando la respuesta
> ya ha llegado entera, porque el proveedor de mentira escribe al instante. Que cancelar corte de verdad la
> llamada al proveedor se comprueba en el test de API, contra el registro de invocaciones.

> **Sobre AX2, y los tres agujeros que destapó.** Se generó tráfico de verdad contra una instancia aparte —con
> telemetría encendida y en su propio puerto, para no tocar la que estaba en uso—: once invocaciones completadas,
> una cortada por cupo, dos rechazadas por el proveedor y una con el cortacircuitos abierto. Las trazas cuelgan
> donde tienen que colgar (`ai.invocation` bajo el manejador de su propio POST) y llevan proveedor, modelo,
> tarea, variante de contexto, tokens estimados y reales, desenlace y tiempo hasta la primera palabra. **Ningún
> contenido**, como manda RNF-801.
>
> Lo que el tráfico encontró y ningún test veía:
>
> 1. **El corte por cupo respondía 500.** El servicio lanzaba su error de dominio y la ruta lo convertía en
>    «Assist failed». Ahora es un **402** con motivo y cifras. 402 y no 429 a propósito: un 429 invita a
>    reintentar en un rato, y esto no se arregla esperando un rato.
> 2. **Un fallo del proveedor al contar tokens respondía 500.** La taxonomía de errores solo servía dentro del
>    flujo; antes de empezar no había traducción. Ahora lleva estado, tipo y explicación.
> 3. **Ese fallo no dejaba fila.** Se registra como invocación fallida con cero tokens, por el mismo motivo que
>    el corte por cupo: sin ella, el panel de errores queda ciego justo para la clase de fallo más común.
>
> Y dos paneles apuntaban a métricas **que no existen**: el exportador añade la unidad al nombre, así que lo que
> Prometheus tiene es `foundry_ai_ttft_milliseconds_bucket`, no `foundry_ai_ttft_bucket`. Esos dos paneles
> llevaban vacíos desde que se escribieron y nadie podía saberlo sin mirar.
>
> Nueve de los diez paneles quedan con datos. El décimo —«Desfase del contador de cupo»— sigue vacío **y así
> debe estar**: solo se mueve cuando una conciliación corrige un descuadre, y no haberlo es el estado deseado.


---

## H11 — Cierra «no tengo ideas»

> Objetivo: que alguien que abre el producto sin una idea concreta salga de ahí con una app creada y su visión
> ya empezada. Es la otra mitad del valor de la v2: H10 ayuda a escribir lo que ya se piensa, y esto ayuda a
> tener qué pensar.
>
> Lo que **no** entra: agentes (H12 y H13). Y una línea que no se cruza: lo que sale del conocimiento del
> modelo no se presenta como si saliera del mercado (RF-1305). Una propuesta que finge estar fundamentada es
> peor que ninguna, porque se decide sobre ella creyendo que hay datos detrás.

### Bloque AY — Las ideas por dentro

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AY1 | El esquema de una propuesta, en el subconjunto estricto | Todos los campos obligatorios, `additionalProperties: false`, lo opcional como unión con `null` | RF-1303, T-24 | ✅ |
| AY2 | Las restricciones, todas opcionales, en el prompt | Sin rellenar nada se propone igual | RF-1302 | ✅ |
| AY3 | Investigar y luego dar forma: dos llamadas cuando hay búsqueda web | La primera trae hallazgos con fuentes; la segunda da forma citándolas | RF-1304, T-25 | ✅ |
| AY4 | Sin búsqueda web, una sola llamada y el resultado va marcado | Se dice que sale del conocimiento del modelo, no de datos de mercado | RF-1305 | ✅ |
| AY5 | Otra tanda sin repetir lo ya visto | Los títulos vistos viajan como exclusiones | RF-1307 | ✅ |
| AY6 | Ruta de generación en streaming, por el paso común de invocación | Las propuestas llegan conforme se arman, con su cupo y su registro | RF-1301, RF-1306, RD-10 | ✅ |


> **Sobre AY.** Dos llamadas cuando el modelo sabe buscar, y por tanto **dos invocaciones**: dos consumos de
> tokens distintos, cada uno con su cupo y su fila. Contarlas como una sería mentir sobre lo que cuesta esta
> función. Si la investigación falla, no se sigue: dar forma a unas propuestas «fundamentadas» sobre una
> investigación que no llegó a hacerse es justo lo que RF-1305 prohíbe.
>
> Las propuestas salen conforme cierran su llave, no cuando termina el objeto entero: el JSON final no existe
> hasta el último carácter, y esperarlo deja la pantalla en blanco toda la generación. El recorrido lleva estado
> —una llave dentro de una cadena no abre nada, una comilla escapada no cierra— porque sin él una propuesta que
> hable de «{}» partiría la lista por la mitad.
>
> Y los dos proveedores de mentira dejan de ser iguales: uno busca en la web y el otro no. Sin esa diferencia, la
> rama de «esto no está fundamentado» se habría dado por buena sin ejecutarse nunca.

### Bloque AZ — De la propuesta a la app

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AZ1 | Elegir crea la app en una sola transacción | Nombre, descripción, estado `IDEA` y etiquetas sugeridas | RF-1308 | ✅ |
| AZ2 | La visión sembrada como copia de trabajo, sin versión | Nace con cambios sin commitear, sobre la plantilla de la v1 | RF-1308, RF-503, RF-505 | ✅ |
| AZ3 | Constancia de que la visión nació de una propuesta | Visible en la ficha mientras nadie haya commiteado | RF-1311 | ✅ |
| AZ4 | Acceso y precursor, por las reglas de la v1 sin excepción | Crearla con ayuda de la IA no cambia de quién es | RF-1310, D-9 | ✅ |
| AZ5 | Lo descartado no deja rastro | Sin elegir, solo queda el registro de la invocación | RF-1312 | ✅ |


> **Sobre AZ.** Elegir una propuesta pasa por el **mismo alta** que crear una app a mano: slug, icono, nivel de
> acceso, precursor y auditoría se deciden en un único sitio. Es la forma de garantizar RF-1310 —crear una app
> con ayuda de la IA no cambia de quién es— sin confiar en que dos caminos se mantengan sincronizados.
>
> Lo único que cambia es el documento: nace **sin versión**, con la visión en la copia de trabajo. Lo que ha
> escrito un modelo llega como borrador y no como algo que alguien haya dado por bueno; darlo por commiteado
> sería firmar en nombre de quien todavía no lo ha leído.
>
> La propuesta viaja de vuelta entera al elegirla, y eso es deliberado: **no se guarda ninguna**. Guardarlas «por
> si acaso» dejaría cuatro ideas descartadas por cada una elegida, y ninguna de ellas es de nadie (RF-1312).
>
> Una consecuencia que conviene conocer: hasta el primer commit, una app así **no admite comentarios inline**,
> porque un hilo pertenece a una versión y todavía no hay ninguna. Es coherente con la v1 y se resuelve
> commiteando, que es un clic, pero no es evidente.

### Bloque BA — Las ideas en la interfaz

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| BA1 | La vía «no sé qué construir», junto a crear a mano | En el mismo panel de creación de la home del workspace | RF-1301 | ✅ |
| BA2 | El formulario de restricciones, todo opcional | Se genera sin rellenar nada | RF-1302 | ✅ |
| BA3 | Las fichas aparecen conforme llegan | Sin esperar al lote completo | RF-1306 | ✅ |
| BA4 | Fuentes con enlace, o el aviso de que no las hay | Nunca se presenta como fundamentado lo que no lo está | RF-1304, RF-1305 | ✅ |
| BA5 | Otra tanda conservando las entradas | Y sin repetir lo que ya se enseñó | RF-1307 | ✅ |
| BA6 | Elegir aterriza en el editor con el borrador delante | Y con el aviso de cambios sin commitear | RF-1309 | ✅ |
| BA7 | Sin disponibilidad, la vía no aparece | Ni con la IA apagada, ni sin modelo asignado | RF-1010 | ✅ |

### Bloque BB — Cerrar H11

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| BB1 | Recorrido completo con el proveedor de mentira | De «no tengo ideas» a la app con su borrador delante | RNF-905 | ✅ |

> **Sobre BA y BB, y dos fallos que encontró el recorrido.**
>
> 1. **Configurar la IA no hacía aparecer nada hasta recargar.** La invalidación de caché al configurar un
>    proveedor tocaba proveedores, ajustes, modelos, tareas y consumo, pero **no la disponibilidad**, que es
>    justo de lo que dependen los puntos de uso. Solo se notaba si la pantalla que los ofrece ya se había
>    pintado antes de configurar, que es lo que hace cualquiera. Afectaba también al asistente.
> 2. **Un `<form>` dentro de otro `<form>`.** El panel de ideas vive dentro del formulario de crear a mano, y
>    anidarlos es HTML inválido: el navegador se lo tomaba como quería y el panel se reiniciaba al pedir ideas.
>    Los campos no necesitaban formulario propio.
>
> Y el proveedor de mentira aprende a responder **lo que el esquema pide** cuando no lleva guion. Un `{}`
> obligaba a cada recorrido a escribir a mano una respuesta con la forma exacta de su esquema, y esa copia
> envejece mal: cambiar el esquema dejaría los guiones antiguos dando por buena una forma que ya no vale. Sirve
> igual para los esquemas de H12 y H13 sin saber nada de ellos.

---

## H12 — Un interlocutor con perfil

> Objetivo: que en un hilo de una app se pueda escribir `@arquitecta ¿esto se sostiene?` y conteste alguien con
> criterio propio, que recuerda lo que ya dijo ahí y que sabe callarse. Es la primera vez que la IA **escribe en
> el producto**: hasta ahora todo lo que generaba un modelo pasaba por un «aceptar» de una persona —un diff, una
> propuesta de app—, y un comentario de agente se queda escrito sin que nadie lo firme.
>
> Lo que **no** entra: la revisión en abanico (H13). Aquí un agente habla cuando le hablan, de uno en uno.
>
> Y entra el **catálogo de fábrica** (RF-1513..1515): seis perfiles listos —producto, marketing, dirección
> técnica, diseño, abogado del diablo, y datos y métricas— para que estrenar la función no empiece por
> redactar un prompt de personalidad en una caja vacía.
>
> Dos cosas que la tabla de hitos coloca en H13 y que aquí no se pueden aplazar. La primera, los **cortafuegos**
> de RF-1604 y RF-1605: son la condición de entrada del disparo, no un añadido posterior, y sin ellos H12
> entregaría agentes capaces de contestarse entre sí. La segunda, la **cola y el worker**: el TRD manda las
> respuestas de agente a `ai:agent-reply` (§11.2, T-32), así que `apps/worker` nace aquí. H13 hereda las dos y
> añade lo suyo: abanico sobre la versión, estimación, confirmación, cancelación y la suite de RNF-902.

### Bloque BC — El modelo de datos

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| BC1 | Plantillas de agente en el workspace | Nombre, handle único ahí, icono, prompt y modelo propio opcional | RF-1501, RF-1104 | ✅ |
| BC2 | El agente como instancia en una app, con handle único en ella | Dos apps pueden repetir handle; una app, no | RF-1503, RF-1506, RF-1512 | ✅ |
| BC3 | El prompt como revisión numerada, no como texto suelto | Ajustarlo añade revisión; la anterior sigue legible | RF-1510 | ✅ |
| BC4 | Desactivar y retirar sin borrar | `active` y `removed_at`; lo escrito se queda donde está | RF-1508, RF-1509 | ⬜ |
| BC5 | Autoría polimórfica con el invariante en el motor | Autor único en comentarios e hilos, y migración sin ventana sin autor | T-34, RF-1601 | ⬜ |
| BC6 | Las menciones a agentes, en su propia tabla | Una invoca y la otra notifica; ninguna finge ser la otra | T-34, RF-1602 | ⬜ |
| BC7 | La invocación sabe qué agente la provocó | `actor_agent_id` junto al `actor_user_id` que ya había | RD-10, RF-1201 | ⬜ |
| BC8 | Las tablas nuevas entran en la suite de aislamiento | Con el rol de la aplicación, no como superusuario | RNF-603, RNF-904 | ⬜ |

> **Sobre BC5.** Es la única migración de H12 que toca datos que ya existen, y el orden importa: las columnas
> pasan a admitir nulo **después** de que toda fila tenga autor, y las restricciones se añaden `NOT VALID` y se
> validan a continuación, para no bloquear la tabla de comentarios mientras se comprueba. No hay ningún instante
> en el que un comentario pueda quedarse sin dueño.
>
> Dos columnas excluyentes y no una tabla de autores intermedia (T-34): así el invariante «exactamente uno» lo
> garantiza Postgres con un `CHECK`, y las dos claves ajenas siguen siendo obligatorias cada una por su lado. Con
> una tabla intermedia, «este comentario no es de nadie» sería una fila válida.
>
> **Sobre BC3.** Cada comentario apunta a la **revisión** del prompt con la que se escribió, no a una copia del
> texto: duplicar kilobytes por línea escrita sería tirar el espacio, y la pregunta que hay que poder contestar
> —«¿por qué dijo esto?»— se contesta igual de bien con un puntero.

### Bloque BD — Plantillas e instancias

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| BD1 | Alta, edición y borrado de plantillas, solo del `OWNER` | Un miembro no las escribe ni por la API | RF-1501, RF-1502 | ⬜ |
| BD2 | El catálogo de fábrica, seis perfiles, como datos en `core` | Product owner, marketing, dirección técnica, diseño, abogado del diablo, y datos y métricas | RF-1513, RF-1514 | ⬜ |
| BD3 | Adoptar una del catálogo la copia al workspace | Y ahí se corta el vínculo: editar la copia no toca el catálogo, ni al revés | RF-1514 | ⬜ |
| BD4 | Adoptar es crear, así que lo hace el `OWNER` | Un miembro con edición no puede, ni por la API | RF-1502, RF-1514 | ⬜ |
| BD5 | Un handle que ya existe se avisa y se deja elegir otro | Nunca se sobrescribe la plantilla que había | RF-1515, RF-1506 | ⬜ |
| BD6 | Añadir y quitar agentes lo hace quien pueda editar la app | Con lectura no; el invitado con edición sí | RF-1503 | ⬜ |
| BD7 | El prompt se ajusta para esa app sin tocar la plantilla | Editar la instancia no cambia la plantilla, ni la plantilla las instancias | RF-1504, RF-1505 | ⬜ |
| BD8 | De qué plantilla desciende y si se ha desviado de ella | Y adoptar el cambio de la plantilla cuando se quiera | RF-1504, RF-1505 | ⬜ |
| BD9 | Tope de agentes por app, configurable de instancia | Cinco por defecto; el sexto se rechaza diciendo por qué | RF-1507, RNF-1002 | ⬜ |
| BD10 | Auditoría de plantillas y agentes, sin cuerpo de prompt | Se registra que cambió, no lo que dice | RF-1702, RF-1703 | ⬜ |
| BD11 | El *seed* trae el proveedor de mentira y dos plantillas del catálogo | El flujo se prueba sin configurar nada ni gastar cuota de nadie | RNF-1003, RF-1513 | ⬜ |

> **Sobre BD2, BD3 y BD4 — el catálogo de fábrica.** Nadie debería tener que redactar un prompt de personalidad
> para poder probar la función por primera vez, así que el producto trae seis perfiles que no se pisan: quién
> lo quiere y para qué, cómo se cuenta, si se puede construir, cómo se usa, por qué podría no funcionar y cómo
> se sabría (RF-1513).
>
> Viven en el código y no en la base (RF-1514). No son contenido de nadie, nadie los edita desde la aplicación
> y mejoran al desplegar; una tabla solo añadiría filas que mantener sincronizadas con el fichero de al lado.
>
> Adoptar uno **copia** y corta el vínculo: no se guarda de qué entrada salió. Guardarlo llevaría derecho a la
> pregunta «el catálogo cambió, ¿lo adoptas?», que entre dos filas del workspace tiene sentido —el cambio lo
> hizo alguien conocido (RF-1505)— y aquí no: sería proponerle al dueño adoptar una decisión nuestra sobre un
> texto que él ya hizo suyo.
>
> Y una consecuencia que conviene conocer, porque no es evidente y es el precio de esta forma: como adoptar es
> **crear una plantilla**, lo hace el `OWNER` y nadie más. Un miembro con permiso de edición puede añadir
> agentes a su app, pero solo a partir de plantillas que ya estén en el workspace. Un workspace recién creado
> necesita un gesto de su dueño antes de que ninguna app pueda tener agentes. A cambio, `agents.template_id`
> apunta siempre a una fila y no hace falta una segunda relación polimórfica —encima de la de los comentarios—
> solo para saber de dónde desciende un agente.
>
> **Sobre BD7 y BD8.** Editar una plantilla no propaga nada, y eso es deliberado: una instancia lleva el prompt
> con el que sus comentarios se escribieron, y reescribirla a distancia dejaría un historial en el que el agente
> dice cosas que su perfil actual no explica. Lo que sí se hace es **avisar** en las apps afectadas y ofrecer
> adoptar el cambio, que es una decisión de quien edita esa app y no del dueño del workspace.

### Bloque BE — Cuándo habla un agente, y cuándo calla

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| BE1 | `apps/worker`, consumidor de las colas de IA, aparte de la API | Un pico de respuestas no degrada la navegación | T-32, RNF-705 | ⬜ |
| BE2 | La cola `ai:agent-reply`, con reintentos y cortacircuitos por proveedor | Solo `TRANSIENT` y `RATE_LIMIT` se reintentan; un `AUTH` no | RNF-703, RNF-704 | ⬜ |
| BE3 | Disparo por mención: una **persona** escribe `@handle` en su app | El agente contesta en ese hilo, en su papel | RF-1602 | ⬜ |
| BE4 | Disparo por réplica: una **persona** responde donde el agente ya escribió | Sin volver a mencionarlo | RF-1602 | ⬜ |
| BE5 | Lo escrito por un agente no dispara a nadie | `author_id IS NOT NULL` como condición de entrada del consumidor | RF-1604, T-35 | ⬜ |
| BE6 | Una mención escrita por un agente no se registra ni avisa | Ni en `comment_agent_mentions` ni en `comment_mentions` | RF-1604 | ⬜ |
| BE7 | Tope de intervenciones por hilo y agente, configurable de instancia | Al tercero calla; una mención explícita le devuelve la palabra | RF-1605, RNF-1002 | ⬜ |
| BE8 | Commitear una versión no invoca a nadie | Guardar sigue siendo gratis | RF-1603 | ⬜ |
| BE9 | Perfil y contenido, separados al construir la petición | Un documento que pida saltarse el perfil no cambia el comportamiento | RF-1614, RNF-605 | ⬜ |
| BE10 | El contexto entregado: perfil, metadatos de la app y el hilo | Nunca otras apps, nunca otro workspace | RNF-604, RF-1512 | ⬜ |
| BE11 | El comentario guarda la revisión de prompt con la que se generó | Editar la personalidad después no reescribe la historia | RF-1510 | ⬜ |
| BE12 | La respuesta pasa por el paso común de invocación | Cupo, registro y traza, con su `actor_agent_id` y tarea `AGENT_REPLY` | RF-1201, RD-10 | ⬜ |
| BE13 | Un reintento no duplica el comentario | Escritura y cierre del trabajo en la misma transacción, con clave de idempotencia | T-33, RNF-703 | ⬜ |
| BE14 | Las personas se enteran; el agente no recibe nada | Misma audiencia que entre personas | RF-1612, RF-902 | ⬜ |
| BE15 | Silenciar los avisos de un agente concreto | Sigue escribiendo; deja de avisar a quien lo silenció | RF-1612 | ⬜ |

> **Sobre BE1 y BE2.** Una respuesta de agente no se espera mirando la pantalla, así que no tiene por qué vivir
> dentro de una petición HTTP: va a la cola y el worker la escribe cuando la tiene. De paso resuelve gratis lo
> que en el asistente costó trabajo —reintentos con espera creciente, concurrencia acotada por proveedor,
> cancelación— porque lo pone la librería y no nosotros (T-32).
>
> El worker es **proceso aparte** desde el primer día. Meterlo dentro de la API sería más rápido hoy y muy caro
> en H13: cinco agentes revisando a la vez comparten CPU y límite de tasa con quien está navegando.
>
> **Sobre BE5, BE6 y BE7 — los tres cortafuegos.** Ninguno de los tres se le pide al modelo, porque un cortafuegos
> que vive en un prompt es una súplica (T-35). Los tres son condiciones comprobables con una consulta:
>
> 1. Que un agente no reaccione a otro es `author_id IS NOT NULL` en el consumidor del evento.
> 2. Que su mención no invoque ni notifique es no insertar la fila; el texto `@handle` sigue ahí, pero no
>    significa nada.
> 3. Que el tope se respete es contar sus comentarios en ese hilo antes de encolar.
>
> El tope tiene una salvedad que conviene ver escrita: una **mención explícita de una persona** le devuelve la
> palabra aunque lo hubiera agotado (RF-1605). El tope existe para que un hilo no se llene solo, no para dejar
> mudo a quien alguien está llamando a propósito.
>
> **Sobre BE9.** La garantía de que un documento no reprograme a un agente es estructural y no textual: un agente
> sin herramientas solo puede escribir un mal comentario (RF-1601, RNF-605). Separar perfil de contenido en la
> petición es la segunda línea, no la primera. Es la diferencia entre limitar el daño y confiar en que no ocurra.

### Bloque BF — Los agentes en la interfaz

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| BF1 | Plantillas en los ajustes del workspace | Solo para el `OWNER`, con icono como el de las apps | RF-1501, RF-1502, D-14 | ⬜ |
| BF2 | Sin plantillas propias, el catálogo en lugar del estado vacío | Y adoptar una es un solo gesto | RF-1515 | ⬜ |
| BF3 | Sección de agentes en la ficha de la app | Icono, perfil y estado; y sin colarse en los contribuidores | RF-1511 | ⬜ |
| BF4 | Aviso de que la plantilla de origen cambió, y adoptarlo | En la app afectada, no en la plantilla | RF-1505 | ⬜ |
| BF5 | Los agentes, mencionables desde el compositor | Distinguibles de una persona en la lista y en el texto | RF-1506, RF-815 | ⬜ |
| BF6 | Distintivo de IA en el comentario y en el panel de hilos | Sin depender del icono | RF-1611, RF-1701 | ⬜ |
| BF7 | La respuesta aparece sin recargar | Por el canal que ya alimenta los avisos | RF-1602, T-6 | ⬜ |
| BF8 | Distinguir los hilos con participación de IA | Y que cuenten como abiertos y se busquen igual que los demás | RF-1613, RF-811 | ⬜ |
| BF9 | Un agente retirado, marcado allí donde escribió | Mismo criterio que con una persona | RF-1509, RF-813 | ⬜ |
| BF10 | Con qué proveedor y modelo se generó, a la vista | En el propio comentario | RF-1704 | ⬜ |
| BF11 | Borrar un hilo de agente, como cualquier otro | Lo hace el precursor de la app | RF-1705, RF-806 | ⬜ |
| BF12 | Sin disponibilidad, los agentes no se ofrecen | Ni con la IA apagada, ni sin modelo asignado a su tarea | RF-1010 | ⬜ |

> **Sobre BF7.** Es la primera vez que algo aparece en el panel de comentarios **sin que quien mira haya hecho
> nada**: el agente contesta cuando el worker termina, que puede ser diez segundos después de mandar la mención.
> No se monta un canal nuevo para eso —el de avisos ya llega a esa pantalla (T-6)— pero sí hay que decidir qué
> hacer mientras tanto, porque un hilo que no acusa recibo de la mención parece roto.
>
> **Sobre BF5 y BF6.** Que un agente se distinga de una persona es requisito en **todas partes** donde aparezca
> (RF-1506), y el icono no basta: un emoji de colores es exactamente lo que también tiene un compañero. El
> distintivo es aparte del icono a propósito (RF-1611).

### Bloque BG — Cerrar H12

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| BG1 | Suite explícita de cortafuegos | Un agente no reacciona a otro; su mención no invoca ni avisa; el tope se respeta | RNF-902 | ⬜ |
| BG2 | Recorrido completo con el proveedor de mentira | Adoptar del catálogo, añadir agente, mencionarlo, que conteste, replicarle y que calle al tope | RNF-905 | ⬜ |

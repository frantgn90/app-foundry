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
| U26 | El menú flotante, bajo la selección y a su derecha, no donde quedó el puntero | Se posiciona con el ratón: arrastrar deprisa lo deja lejos, y arrastrar hacia la izquierda lo deja al principio | ⬜ |
| U27 | Detectar la selección por el cambio de selección, y resolver también los bloques enteros | Doble clic, triple clic, teclado y títulos no ofrecían menú: el disparador era `mouseup` y el rastro de posición se buscaba desde el contenedor común | ⬜ |

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
| **H9**  | Puerto y adaptadores, cifrado de credenciales, catálogo por API, modelo por tarea, cupos       | La IA ya tiene grifo y contador    |
| **H10** | Arreglo del menú de selección (U26, U27) y asistente de escritura, con diff que se acepta      | **Primer valor real**              |
| **H11** | Generación de ideas, con y sin búsqueda web, y la app creada con su visión sembrada            | Cierra «no tengo ideas»            |
| **H12** | Agentes: modelo, plantillas, instancias, autoría polimórfica, menciones y respuestas           | Un interlocutor con perfil         |
| **H13** | Revisión en abanico: cola, estimación, confirmación, cancelación y cortafuegos                 | **Pensar acompañado, completo**    |
| **H14** | Panel de Grafana, recorrido de extremo a extremo, conciliación de cupos y cierre               | v2 completa                        |

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
| AO3 | Proveedor de mentira que implementa el puerto | Streaming simulado, cada `kind` de error y conteos deterministas, sin red | T-36, RNF-901 | ⬜ |
| AO4 | Registro de proveedores y resolución por `ProviderId` | Añadir un proveedor es registrar un adaptador, sin tocar dominio ni interfaz | RD-8, O12 | ⬜ |
| AO5 | Esquemas del producto en el subconjunto estricto | Un test rechaza cualquier esquema con campos opcionales o `additionalProperties` abierto | T-24 | ⬜ |
| AO6 | Adaptador de Anthropic: texto, objeto con esquema, búsqueda web y conteo exacto | Contra el SDK oficial; el error de búsqueda que llega con HTTP 200 se traduce a la taxonomía | T-23, §6 | ⬜ |
| AO7 | Adaptador de Groq: texto, objeto con decodificación restringida y aproximación de tokens | El mismo esquema del producto vale sin traducción; la aproximación redondea siempre al alza | T-23, T-24, §10 | ⬜ |

### Bloque AP — Credenciales y proveedores del workspace

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AP1 | Tablas `workspace_ai_providers` y `workspace_ai_credentials` | El esquema declarado coincide con el aplicado | §7.1, RF-1001 | ⬜ |
| AP2 | Cifrado AES-256-GCM con clave versionada y datos autenticados | Mover una fila cifrada a otro workspace la vuelve indescifrable | T-26, RNF-601 | ⬜ |
| AP3 | Función `SECURITY DEFINER` y `SELECT` revocado sobre la credencial | El rol de aplicación no puede leer la tabla directamente | T-27, RNF-603 | ⬜ |
| AP4 | Políticas RLS de las tablas nuevas y ampliación de la suite de aislamiento | Un miembro que no es dueño no lee la credencial de su propio workspace | RNF-603, RNF-904 | ⬜ |
| AP5 | API de configurar, verificar, desactivar y borrar un proveedor | Una clave inválida se rechaza en el acto y con motivo; el proveedor no queda activo | RF-1002..1006 | ⬜ |
| AP6 | Advertencia de envío a terceros, con registro de quién la aceptó | Activar el primer proveedor exige aceptarla | RF-1011 | ⬜ |
| AP7 | Interruptor general de IA del workspace | Apagarla no borra configuración ni agentes; volver a encenderla lo restituye | RF-1012 | ⬜ |
| AP8 | Auditoría de todo lo anterior | Ni una credencial, ni un fragmento de contenido, en ninguna entrada | RF-1702, RF-1703 | ⬜ |
| AP9 | Rotación de la clave de instancia y recifrado en lote | Con dos claves activas se descifra lo viejo y se cifra con la nueva | T-26 | ⬜ |

### Bloque AQ — Catálogo de modelos y asignación por tarea

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AQ1 | Tabla `ai_models` y lectura del catálogo desde la API del proveedor | Ventana de contexto y capacidades salen del proveedor, no de una constante | T-28, RF-1007 | ⬜ |
| AQ2 | Caché con refresco en segundo plano y último catálogo conocido | Con el proveedor caído se sigue sirviendo lo último que se supo | RF-1009 | ⬜ |
| AQ3 | Tabla `workspace_task_models` y API de asignación por tarea | Solo el dueño asigna; el resto consume lo asignado | RF-1101, RF-1102, RF-1107 | ⬜ |
| AQ4 | Asignación por defecto propuesta al configurar el primer proveedor | Editable siempre; con un solo proveedor, todas las tareas van a él | RF-1103 | ⬜ |
| AQ5 | Aviso cuando el modelo asignado desaparece del catálogo | Se avisa al dueño, no se falla cuando alguien usa la función | RF-1009 | ⬜ |
| AQ6 | Rechazo por ventana de contexto insuficiente | Se explica qué pasa y qué hacer; nunca se recorta el documento en silencio | RF-1106 | ⬜ |

### Bloque AR — Consumo y cupos

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AR1 | Tabla `ai_invocations` con sus índices | Entrada y salida separadas; ni una línea de contenido | RF-1201, RF-1202, T-29 | ⬜ |
| AR2 | Contador en Redis con script Lua: reserva atómica y liquidación | Cinco reservas simultáneas no se saltan el cupo entre todas | T-30, §9.2 | ⬜ |
| AR3 | Reconstrucción del contador desde el registro, y fallo cerrado sin Redis | Borrando la clave, el consumo del mes vuelve a salir correcto | §9.3, T-31 | ⬜ |
| AR4 | Barrido de reservas huérfanas | Una reserva sin liquidar deja de comer cupo al vencer | §9.2 | ⬜ |
| AR5 | Conciliación periódica del contador contra el registro | Una liquidación perdida se corrige sola en la siguiente pasada | §9.3 | ⬜ |
| AR6 | Cupo mensual por proveedor y corte al agotarse | Agotado uno, las tareas del otro proveedor siguen funcionando | RF-1204, RF-1210 | ⬜ |
| AR7 | Aviso al superar el umbral configurable | Notificación dentro de la aplicación al dueño | RF-1205 | ⬜ |
| AR8 | Límite de invocaciones por miembro y ventana | Sobre el rate limiting que ya existe | RF-1206 | ⬜ |
| AR9 | Estimación previa como techo: entrada contada y salida al máximo | La cifra enseñada nunca se queda por debajo del consumo real | RF-1207, §10 | ⬜ |
| AR10 | API de consumo del workspace | Cada miembro ve el suyo; el dueño, todo | RF-1208 | ⬜ |
| AR11 | Suite de cupos | Concurrencia, reconstrucción, corte y fallo cerrado, con casos negativos | RNF-903 | ⬜ |

### Bloque AS — Ajustes del workspace

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AS1 | Página de proveedores: alta, verificación, estado y credencial enmascarada | La clave no viaja al cliente ni entera ni descifrable | RF-1002, RF-1004 | ⬜ |
| AS2 | Asignación de modelo por tarea desde la interfaz | Se dibuja a partir de las capacidades declaradas, no de una lista fija | RF-1008, RF-1102 | ⬜ |
| AS3 | Cupos y umbral de aviso | Un cupo por proveedor configurado | RF-1204, RF-1205 | ⬜ |
| AS4 | Página de consumo del mes | Desglose por proveedor, tarea, modelo y miembro, con entrada y salida separadas | RF-1208 | ⬜ |
| AS5 | Sin proveedor activo, ninguna función de IA aparece | Ni botones deshabilitados, ni código de IA descargado | RF-1010 | ⬜ |

### Bloque AT — Observabilidad

| # | Tarea | Verificación | Traza | Estado |
|---|---|---|---|---|
| AT1 | Traza por invocación, hija de quien la originó | Con proveedor, modelo, tarea, tokens y latencias; nunca contenido | RNF-801 | ⬜ |
| AT2 | Métricas de invocaciones, tokens, consumo frente al cupo y errores | Visibles en Prometheus con las etiquetas acordadas | RNF-802 | ⬜ |
| AT3 | Panel de Grafana de la IA | Junto a los que ya existen, sin tocarlos | RNF-803 | ⬜ |
| AT4 | Cupo agotado y cortacircuitos, como eventos observables | No solo un mensaje en la interfaz | RNF-804 | ⬜ |

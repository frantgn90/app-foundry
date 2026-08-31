# App Foundry — Documento de Requerimientos (v1)

- **Estado:** Borrador para revisión
- **Fecha:** 2026-08-28
- **Autor:** Juan Francisco Martínez Vera (con asistencia de Claude Code)
- **Fase del proceso:** Requerimientos → (siguiente: TRD) → Implementación

---

## 1. Visión del producto

App Foundry es un **repositorio de ideas de aplicaciones**: un espacio para pensar, definir y traquear apps
antes (y durante) su desarrollo.

Cada usuario tiene su propio **workspace**. Dentro de él crea **apps**, y crear una app consiste,
fundamentalmente, en escribir un **documento de visión (`VISION.md`)** que explica a muy alto nivel de qué va
esa aplicación. El desarrollo del software real ocurre **fuera** de la plataforma, pero toma el `VISION.md`
como punto de partida para la planificación: de la visión saldrán PRDs, de los PRDs saldrán TRDs y de los TRDs
saldrán tareas.

Un usuario puede **invitar a otros a su workspace**, donde podrán colaborar en las ideas compartidas y crear
las suyas propias. Así, la relación *precursor / contribuidor* aparece de forma natural: el precursor es quien
tuvo la idea, los contribuidores son quienes la ayudan a madurar.

El objetivo de la v1 es acotado y deliberado: **una plataforma multiusuario con una UI atractiva donde capturar
y refinar ideas de apps.** El flujo de valor mínimo es: *"tengo una idea que creo que es brillante → entro en
App Foundry → clico en Nueva app → escribo mi visión → queda guardada, versionada y compartible con quien yo
decida"*.

Las capacidades avanzadas (arquitectura de plugins, integración con GitHub y con las tiendas de aplicaciones,
servidor MCP, despliegue SaaS) forman parte de la dirección estratégica del producto y están documentadas en la
sección 9 como fases posteriores. **No entran en v1**, pero el diseño de v1 no debe cerrarles la puerta
(sección 8).

---

## 2. Objetivos y no-objetivos

### 2.1 Objetivos de v1

| # | Objetivo |
|---|---|
| O1 | Que cualquiera pueda darse de alta con un click y disponer al instante de un espacio propio. |
| O2 | Que un usuario no vea nunca nada de nadie salvo que le hayan invitado explícitamente. |
| O3 | Que crear una app y escribir su visión cueste menos de un minuto. |
| O4 | Que el `VISION.md` se pueda refinar en el tiempo sin perder el historial de cómo evolucionó. |
| O5 | Que cada app tenga un responsable claro (precursor) y colaboradores visibles (contribuidores). |
| O6 | Que el dueño de un workspace controle, app por app, qué comparte y con qué nivel de acceso. |
| O7 | Que la experiencia visual sea atractiva: el producto invita a pensar, no solo a rellenar formularios. |
| O8 | Que la instancia se levante en local con un único comando. |

### 2.2 No-objetivos de v1

- **No** es una herramienta de gestión de tareas, sprints ni backlog.
- **No** genera automáticamente PRDs, TRDs ni código a partir de la visión.
- **No** ejecuta ni despliega el software de las apps que documenta.
- **No** integra datos externos (GitHub, App Store, Google Play).
- **No** expone todavía servidor MCP ni runtime de plugins de terceros.
- **No** incluye facturación, planes ni límites de uso.
- **No** incluye edición colaborativa simultánea en tiempo real sobre el mismo documento (tipo Google Docs).
- **No** permite (todavía) crear workspaces adicionales más allá del personal.
- **No** permite mover apps entre workspaces.
- **No** envía correo: las notificaciones viven dentro de la aplicación.
- **No** sube ficheros de ningún tipo: el icono de una app son datos (emoji y color), no una imagen.

---

## 3. Usuarios, workspaces y roles

### 3.1 Personas

- **Dueño de workspace** — todo usuario lo es, del suyo. Crea apps, decide qué comparte e invita colaboradores.
- **Colaborador invitado** — usuario al que han invitado al workspace de otro; lee y, si se le permite, edita
  las apps compartidas allí, y puede crear las suyas propias dentro de ese workspace.
- **Admin de plataforma** — el operador de la instancia. Gestiona cuentas, **no** contenido.

### 3.2 Workspaces

- Un **workspace** es un espacio de trabajo con un dueño, un nombre y un conjunto de miembros. Es la **frontera
  de invitación**: se invita al workspace, nunca a una app suelta.
- Al darse de alta, cada usuario recibe automáticamente su **workspace personal** (RF-105).
- En v1 un usuario **no** puede crear workspaces adicionales; el modelo de datos sí lo contempla (RD-5).
- Al entrar en la plataforma, el usuario aterriza siempre en su workspace personal, y desde ahí puede navegar a
  los workspaces a los que ha sido invitado.

### 3.3 Roles a nivel de plataforma

| Rol | Descripción | Capacidades distintivas |
|---|---|---|
| `ADMIN` | Operador de la instancia | Listar usuarios, desactivar y reactivar cuentas, cambiar roles de plataforma, ver el registro de auditoría y métricas agregadas |
| `MEMBER` | Usuario estándar | Todo lo relativo a su workspace y a aquellos donde ha sido invitado |

- El `ADMIN` **no** tiene acceso al contenido de workspaces ajenos: para leer un workspace tiene que ser
  invitado como cualquier otro usuario (D-6).
- La instancia se inicializa con al menos un `ADMIN` (RF-201) y nunca puede quedarse sin ninguno activo.

### 3.4 Roles a nivel de workspace

| Rol | Cardinalidad | Descripción |
|---|---|---|
| `OWNER` | Exactamente 1 | Dueño del espacio. Único que **crea apps** e invita o expulsa miembros. |
| `MEMBER` | 0..N | Invitado. Accede a las apps compartidas según el nivel de acceso de cada una, y **puede crear apps** en el workspace. No invita, no expulsa, no renombra. |

### 3.5 Roles a nivel de app

| Rol | Cardinalidad | Cómo se obtiene |
|---|---|---|
| `PRECURSOR` | Exactamente 1 | Quien crea la app, sea el `OWNER` del workspace o un invitado. Transferible a otro miembro (RF-408). |
| `CONTRIBUTOR` | 0..N | **Derivado, no se concede**: es contribuidor quien ha guardado al menos una versión de algún documento de la app. |

### 3.6 Visibilidad y acceso de una app

Cada app tiene un nivel de acceso:

| Nivel | Quién la ve | Quién la edita |
|---|---|---|
| `PRIVATE` *(por defecto)* | Solo el precursor | Solo el precursor |
| `WORKSPACE_READ` | Todos los miembros del workspace | Solo el precursor |
| `WORKSPACE_WRITE` | Todos los miembros del workspace | Todos los miembros del workspace |

**Quién elige el nivel:** solo el precursor **cuando es el dueño del workspace**. Una app creada por un
invitado en un workspace ajeno nace y permanece en `WORKSPACE_WRITE`: no puede ser privada ni de sólo lectura.
Nadie usa el espacio de otro como cajón privado, y el dueño no se encuentra con contenido opaco en su propio
workspace.

El dueño del workspace **tampoco** puede cambiar el nivel de acceso de una app ajena: no es su precursor. Solo
pasa a poder hacerlo si hereda el rol al salir esa persona del workspace (RF-413).

### 3.7 Matriz de permisos

| Acción | Precursor | Miembro (app en edición) | Miembro (app en lectura) | Admin plataforma |
|---|:---:|:---:|:---:|:---:|
| Ver la app y su visión | ✅ | ✅ | ✅ | ❌ |
| Ver el historial y los diffs | ✅ | ✅ | ✅ | ❌ |
| Comentar (hilo general e inline) | ✅ | ✅ | ✅ | ❌ |
| Resolver un hilo de comentarios | ✅ | ✅ | ✅ | ❌ |
| Editar la visión / restaurar versión | ✅ | ✅ | ❌ | ❌ |
| Editar metadatos (nombre, estado, tags) | ✅ | ✅ | ❌ | ❌ |
| Cambiar el nivel de acceso de la app | ✅ *(solo si es el owner del workspace)* | ❌ | ❌ | ❌ |
| Archivar o eliminar la app | ✅ | ❌ | ❌ | ❌ |
| Transferir el rol de precursor | ✅ | ❌ | ❌ | ❌ |

Y a nivel de workspace:

| Acción | `OWNER` | `MEMBER` | Admin plataforma |
|---|:---:|:---:|:---:|
| Crear apps en el workspace | ✅ | ✅ *(siempre en `WORKSPACE_WRITE`)* | ❌ |
| Invitar o expulsar miembros | ✅ | ❌ | ❌ |
| Renombrar el workspace | ✅ | ❌ | ❌ |
| Abandonar el workspace | ❌ | ✅ | — |
| Desactivar una cuenta de usuario | ❌ | ❌ | ✅ |

---

## 4. Conceptos del dominio

| Concepto | Definición |
|---|---|
| **Workspace** | Espacio de trabajo con dueño y miembros. Contenedor de apps y frontera de invitación. |
| **App (proyecto)** | La unidad central: una idea de aplicación. Pertenece a un workspace. |
| **Documento de visión** | El markdown, exportable como `VISION.md`, que describe a alto nivel de qué va la app. Único tipo de documento en v1. |
| **Versión** | Instantánea inmutable del contenido de un documento, con autor, fecha y mensaje opcional. |
| **Invitación** | Propuesta, dirigida a un email, para unirse a un workspace concreto. |
| **Handle** | Nombre de usuario de GitHub de una persona (`@juanfran`), usado para mencionarla. |
| **Hilo** | Conversación sobre una app: general al pie del documento, o inline anclada a un fragmento. |
| **Nivel de acceso** | Qué comparte una app dentro de su workspace: privada, lectura o edición. |
| **Estado de app** | Dónde está la idea: `IDEA`, `DEFINING`, `IN_DEVELOPMENT`, `PUBLISHED`, `PAUSED`, `ARCHIVED`. |

---

## 5. Requerimientos funcionales

`DEBE` = obligatorio en v1. `DEBERÍA` = deseable, sacrificable si aprieta el alcance.

### 5.1 Autenticación, alta y sesión

- **RF-101** — El sistema **DEBE** autenticar exclusivamente mediante **OAuth con GitHub**, único proveedor.
  No existen contraseñas propias de App Foundry ni otros proveedores de identidad.
- **RF-102** — El registro **DEBE** ser **abierto**: cualquier persona con cuenta de GitHub que complete el
  flujo obtiene una cuenta activa con rol de plataforma `MEMBER`. No hay lista de invitados ni aprobación
  previa.
- **RF-103** — GitHub **DEBE** entregar un email verificado; si no, el alta se rechaza.
- **RF-104** — La identidad de la cuenta **DEBE** ser el **identificador numérico de GitHub**, no el email ni
  el nombre de usuario, que la persona puede cambiar en GitHub sin dejar de ser la misma. El email y el
  username se guardan y se refrescan en cada login.
- **RF-105** — Al crearse una cuenta, el sistema **DEBE** crear automáticamente su **workspace personal**, con
  ese usuario como `OWNER` y un nombre por defecto derivado de su nombre visible.
- **RF-106** — Si el email del nuevo usuario tiene invitaciones a workspaces pendientes, éstas **DEBEN**
  aplicarse automáticamente al completar el alta.
- **RF-107** — La sesión **DEBE** mantenerse con cookies seguras (`HttpOnly`, `SameSite`, `Secure` fuera de
  local), con caducidad configurable y renovación por actividad.
- **RF-108** — El usuario **DEBE** poder cerrar sesión, invalidándola en el servidor.
- **RF-109** — Toda ruta y endpoint, salvo la pantalla de login y los callbacks OAuth, **DEBE** requerir sesión
  válida.
- **RF-110** — Un usuario desactivado **DEBE** perder el acceso de inmediato: sus sesiones se invalidan y no
  puede volver a autenticarse.
- **RF-111** — El primer administrador **DEBE** poder designarse por configuración (variable de entorno con su
  nombre de usuario de GitHub), aplicándose en su alta.

### 5.2 Administración de la plataforma

- **RF-201** — Un `ADMIN` **DEBE** poder listar todos los usuarios con su rol de plataforma, estado, fecha de
  alta y último acceso.
- **RF-202** — Un `ADMIN` **DEBE** poder cambiar el rol de plataforma de un usuario, salvo que el cambio deje
  la instancia sin ningún administrador activo.
- **RF-203** — Un `ADMIN` **DEBE** poder desactivar y reactivar cuentas. Desactivar **no** borra workspaces,
  apps ni versiones: el contenido y la autoría se conservan.
- **RF-204** — Un `ADMIN` **DEBE** poder ver métricas agregadas de la instancia (número de usuarios, de
  workspaces y de apps) **sin** acceder al contenido de ningún workspace ajeno.
- **RF-205** — La interfaz de administración **DEBE** estar separada de la experiencia normal de trabajo y
  visible solo para `ADMIN`.
- **RF-206** — Cada usuario **DEBE** poder ver y editar su perfil básico: nombre visible y avatar (heredados
  del proveedor OAuth por defecto).
- **RF-208** — El **handle** de una cuenta, usado para las menciones (RF-814), **DEBE** ser su **nombre de
  usuario de GitHub**: ya es único y la persona lo reconoce como suyo, así que no se inventa ni se edita en
  App Foundry. Si cambia en GitHub, **DEBE** actualizarse en el siguiente login.
- **RF-207** — Un usuario **DEBERÍA** poder solicitar la baja de su cuenta; el borrado efectivo lo ejecuta un
  `ADMIN`.

### 5.3 Workspaces e invitaciones

- **RF-301** — El usuario **DEBE** aterrizar por defecto en su workspace personal al iniciar sesión.
- **RF-302** — La interfaz **DEBE** ofrecer un **selector de workspace** que liste el propio y todos aquellos
  a los que ha sido invitado, indicando en todo momento en cuál está.
- **RF-303** — El `OWNER` **DEBE** poder renombrar su workspace.
- **RF-304** — El `OWNER` **DEBE** poder invitar a otra persona **por email**. Si esa persona ya tiene cuenta,
  se le añade como `MEMBER` de inmediato; si no, la invitación queda pendiente y se aplicará cuando se dé de
  alta (RF-106).
- **RF-305** — El `OWNER` **DEBE** poder ver las invitaciones pendientes de su workspace y **revocarlas**.
- **RF-306** — Las invitaciones **DEBERÍAN** caducar transcurrido un plazo configurable.
- **RF-307** — El `OWNER` **DEBE** poder ver la lista de miembros de su workspace y **expulsar** a cualquiera.
  Expulsar no borra ni desatribuye las versiones que esa persona escribió, y sus apps siguen en el workspace
  (RF-413).
- **RF-308** — Un `MEMBER` **DEBE** poder abandonar por su cuenta un workspace ajeno, tras un aviso explícito
  de que las apps que creó allí se quedan (RF-413).
- **RF-309** — Un `MEMBER` **DEBE** poder crear apps en el workspace, que nacerán forzosamente en
  `WORKSPACE_WRITE` (RF-406). Un `MEMBER` **NO** puede invitar, expulsar ni renombrar el workspace.
- **RF-310** — El `OWNER` **NO** puede abandonar ni ser expulsado de su propio workspace, ni transferirlo en
  v1.
- **RF-311** — El envío de emails **NO** es requisito de v1: la invitación se comunica fuera de banda. La UI
  **DEBE** mostrar claramente el email invitado y su estado.
- **RF-312** — Al invitar, el sistema **NO DEBE** exponer un directorio de usuarios de la instancia ni
  confirmar si un email tiene cuenta: se invita a ciegas, por email.

### 5.4 Apps: creación, ciclo de vida y acceso

- **RF-401** — Cualquier miembro de un workspace, sea `OWNER` o `MEMBER`, **DEBE** poder crear apps en él.
  Quien la crea queda como su `PRECURSOR`.
- **RF-402** — La creación **DEBE** ser deliberadamente ligera: únicos campos obligatorios, el **nombre** y el
  **contenido inicial de la visión** (que puede partir de una plantilla).
- **RF-403** — Una app **DEBE** tener: nombre, icono, descripción corta opcional, estado, etiquetas (0..N),
  nivel de acceso, enlace opcional a repositorio, workspace al que pertenece, fecha de creación y de última
  modificación.
- **RF-404** — El estado **DEBE** ser uno de `IDEA`, `DEFINING`, `IN_DEVELOPMENT`, `PUBLISHED`, `PAUSED`,
  `ARCHIVED`. Nace en `IDEA` y las transiciones son libres.
- **RF-405** — El nivel de acceso **DEBE** ser uno de `PRIVATE` (por defecto), `WORKSPACE_READ` o
  `WORKSPACE_WRITE`, con la semántica de la tabla 3.6.
- **RF-406** — El nivel de acceso solo lo elige y lo cambia el precursor **cuando además es el `OWNER` del
  workspace**. Una app creada por un `MEMBER` invitado **DEBE** fijarse en `WORKSPACE_WRITE` y no ser
  modificable **por nadie**, tampoco por el dueño del workspace, que no es su precursor; la UI **DEBE**
  avisarlo al crearla, para que nadie espere privacidad donde no la hay.
- **RF-407** — La UI **DEBE** explicar en lenguaje llano qué implica cada nivel de acceso y a cuánta gente
  pasará a ver la app antes de confirmar el cambio.
- **RF-408** — La ficha de la app **DEBE** mostrar quién es el precursor y quiénes son sus contribuidores
  (derivados del historial de versiones, RF-509).
- **RF-409** — El precursor **DEBE** poder **transferir** el rol a otro miembro del workspace, con confirmación
  explícita.
- **RF-410** — El precursor **DEBE** poder archivar una app: pasa a sólo lectura, sale de los listados por
  defecto y se puede desarchivar.
- **RF-411** — El precursor **DEBE** poder eliminar definitivamente su app, con confirmación explícita
  (escribir el nombre) advirtiendo de que se pierde todo el historial.
- **RF-412** — El nombre **DEBERÍA** generar un identificador legible (*slug*) único dentro del workspace y
  estable, usable en la URL.
- **RF-413** — Una app **DEBE** pertenecer siempre al workspace donde se creó. Si su precursor deja de ser
  miembro —porque abandona o porque lo expulsan—, la app **permanece** en el workspace y el rol de precursor
  **DEBE** pasar automáticamente al `OWNER`, quedando registrado en auditoría. El historial de versiones sigue
  atribuido a quien lo escribió.
- **RF-414** — Si se desactiva o se da de baja al `OWNER` de un workspace, sus apps **DEBEN** conservarse y
  quedar inaccesibles para los miembros hasta que un `ADMIN` reactive la cuenta.
- **RF-415** — Toda app **DEBE** tener un **icono**. Al crearse se le asigna uno por defecto, generado de forma
  **determinista** a partir de su identificador, de modo que dos apps del mismo listado no se parezcan.
- **RF-416** — El precursor **DEBE** poder personalizar el icono eligiendo un **emoji** y un **color de fondo**
  de una paleta acotada. La lista de emojis **DEBE** ser una **selección curada** de unas pocas decenas,
  agrupada por categorías, no el catálogo Unicode completo: se elige rápido y el conjunto mantiene coherencia
  visual. En v1 **no** se suben ficheros de imagen (RD-7); el icono es datos, no un fichero.
- **RF-417** — Una app **DEBERÍA** poder guardar un **enlace a su repositorio de GitHub**, opcional, validado
  en formato y mostrado como enlace en la ficha. En v1 es únicamente un campo informativo: no se sincroniza
  ningún dato, no hay webhooks ni acciones. Es el punto de anclaje de la integración real de la fase 3.

### 5.5 Documento de visión y versionado

- **RF-501** — Cada app **DEBE** tener exactamente un documento de visión, creado junto con la app.
- **RF-502** — El contenido **DEBE** ser **Markdown**, almacenado en base de datos como texto.
- **RF-503** — Al crear una app, la visión **DEBERÍA** partir de una plantilla editable con secciones guía:
  *El problema*, *Para quién es*, *La propuesta de valor*, *Cómo funciona (a alto nivel)*, *Qué la hace
  distinta*, *Cómo sabremos que funciona*, *Riesgos y dudas abiertas*.
- **RF-504** — **DEBE** haber un editor markdown con **previsualización** del resultado renderizado.
- **RF-505** — Guardar y versionar **DEBEN** ser actos distintos. **Guardar** actualiza la **copia de trabajo**
  del documento —compartida por quienes pueden editarlo— sin crear versión, y puede repetirse tantas veces
  como haga falta. **Commitear** crea una **versión inmutable** a partir de la copia de trabajo, con autor,
  marca de tiempo y un **mensaje obligatorio de como mucho 100 caracteres**.
- **RF-506** — El editor **DEBERÍA** guardar un borrador automático local mientras se escribe, sin generar
  versiones.
- **RF-507** — El usuario **DEBE** poder consultar el historial completo de versiones, ordenado
  cronológicamente y con su autor.
- **RF-508** — El usuario **DEBE** poder ver el **diff** entre dos versiones cualesquiera.
- **RF-509** — La lista de contribuidores de una app **DEBE** derivarse de quienes han escrito en sus
  versiones —autor y coautores (RF-516)—, excluyendo al precursor.
- **RF-510** — Quien pueda editar **DEBE** poder **restaurar** una versión anterior. Restaurar **DEBE** cargar
  ese contenido en la copia de trabajo como cambios sin commitear, de modo que pueda revisarse, seguir
  editándose y commitearse con su mensaje —o descartarse (RF-515)—. No borra historial.
- **RF-511** — El sistema **DEBE** detectar ediciones concurrentes: si la copia de trabajo cambió desde que se
  abrió el editor, el guardado se rechaza y se ofrece ver el conflicto en lugar de sobrescribir en silencio.
  La misma comprobación **DEBE** proteger al commit y al descarte (RF-515).
- **RF-515** — Quien pueda editar **DEBE** poder **descartar** los cambios sin commitear, devolviendo la copia
  de trabajo a la versión actual. Como lo descartado no queda en ninguna versión, la acción **DEBE** avisar
  antes de qué se pierde y de quién es, y **DEBE** quedar registrada en la auditoría.
- **RF-516** — Una versión **DEBE** registrar como **coautores** a quienes guardaron cambios desde la versión
  anterior sin ser quien commitea. Sin esto, el trabajo de quien escribe y no commitea desaparecería del
  historial de autoría.
- **RF-512** — Cualquiera que pueda leer la app **DEBE** poder descargarla como fichero `VISION.md`. El fichero
  **DEBE** incluir una cabecera de metadatos (nombre de la app, workspace, número de versión, autor de esa
  versión, fecha y estado), de modo que un documento exportado sea identificable fuera de la plataforma.
- **RF-513** — El renderizado de markdown **DEBE** sanearse para evitar inyección de HTML/JS.
- **RF-514** — El modelo de datos **DEBERÍA** contemplar que una app tenga *varios* documentos de distintos
  tipos (`VISION` y, en el futuro, `PRD` y `TRD`), aunque en v1 solo se cree y muestre el de visión.

### 5.6 Navegación, búsqueda y experiencia

- **RF-601** — La pantalla principal **DEBE** ser el listado de apps del workspace activo visibles para el
  usuario, con una presentación cuidada (tarjetas con nombre, descripción, estado, etiquetas, precursor,
  indicador de nivel de acceso y fecha de actualización).
- **RF-602** — El listado **DEBE** permitir filtrar por estado, por etiqueta y por nivel de acceso.
- **RF-603** — El listado **DEBE** permitir ordenar al menos por fecha de actualización y por nombre, y
  **DEBE** estar paginado.
- **RF-604** — **DEBE** existir búsqueda por texto sobre nombre, descripción y contenido de la visión,
  abarcando **todos** los workspaces a los que el usuario pertenece e indicando de cuál procede cada resultado.
  La búsqueda respeta siempre los permisos: nunca devuelve apps privadas de otros.
- **RF-605** — El botón **"Nueva app"** **DEBE** ser el elemento de acción más visible, en cualquier workspace
  del que el usuario sea miembro.
- **RF-606** — En un workspace ajeno, la UI **DEBE** dejar claro que se está de invitado, advertir de que lo
  que se cree allí será visible y editable por todo el workspace, y **no** ofrecer acciones que el usuario no
  puede ejecutar.
- **RF-607** — La ficha de una app **DEBE** mostrar en una pantalla: metadatos, visión renderizada, precursor y
  contribuidores, nivel de acceso y acceso al historial.
- **RF-608** — La interfaz **DEBE** ser responsive y usable en portátil y escritorio; el soporte móvil es
  deseable, no bloqueante.
- **RF-609** — La interfaz **DEBERÍA** ofrecer tema claro y oscuro.
- **RF-610** — Los estados vacíos (workspace sin apps, sin resultados, sin miembros) **DEBERÍAN** estar
  diseñados y orientar a la siguiente acción.
- **RF-611** — **DEBERÍA** haber atajos de teclado para las acciones frecuentes (nueva app, buscar, guardar,
  cambiar de workspace).

### 5.7 Auditoría

- **RF-701** — El sistema **DEBE** registrar como mínimo: inicio de sesión, alta de usuario, desactivación y
  reactivación, cambio de rol de plataforma, creación y revocación de invitación, aceptación de invitación,
  expulsión y abandono de workspace, creación de app, cambio de nivel de acceso, transferencia de precursor
  (voluntaria o heredada), archivado y borrado de app, creación de versión de documento, y borrado de un hilo
  de comentarios por alguien distinto de su autor.
- **RF-702** — Cada entrada **DEBE** contener quién, qué, sobre qué recurso, en qué workspace y cuándo.
- **RF-706** — El registro de auditoría **NO DEBE** contener datos sensibles: ni contenido de documentos o
  comentarios, ni tokens o credenciales, ni direcciones IP. Registra **qué pasó**, no **qué decía**.
- **RF-703** — Un `ADMIN` **DEBE** poder consultar los eventos **de plataforma** (altas, bajas, roles,
  sesiones), filtrando por usuario y por fecha, **sin** que ello le dé acceso al contenido de los workspaces.
- **RF-704** — El `OWNER` de un workspace **DEBERÍA** poder consultar la actividad ocurrida dentro de él.
- **RF-705** — El registro **DEBE** ser de sólo escritura desde la aplicación: no editable ni borrable desde la
  UI.

### 5.8 Comentarios y anotaciones

- **RF-801** — Cada app **DEBE** tener un **hilo de comentarios general**, situado al pie del documento de
  visión. El hilo general es de la **app**, no de una versión: la conversación sobre la idea es continua y no
  se cierra porque alguien commitee.
- **RF-802** — El sistema **DEBE** permitir además **comentarios inline**: anclados a una selección concreta de
  texto del documento renderizado, al estilo de Confluence o Google Docs.
- **RF-803** — **DEBE** poder comentar cualquiera que tenga acceso de **lectura** a la app, incluidos los
  miembros que solo pueden leerla (`WORKSPACE_READ`). Comentar no requiere permiso de edición y **nunca**
  modifica el documento ni genera versiones.
- **RF-804** — Los hilos **DEBEN** admitir **respuestas anidadas a un solo nivel**: un comentario raíz y sus
  respuestas. No hay anidamiento arbitrario.
- **RF-805** — El cuerpo de un comentario **DEBERÍA** admitir markdown básico (énfasis, listas, enlaces,
  código), saneado igual que el documento (RF-513).
- **RF-806** — El autor **DEBE** poder editar y borrar sus propios comentarios; un comentario editado **DEBE**
  marcarse como tal. El precursor de la app **DEBE** poder borrar cualquier hilo.
- **RF-807** — Los hilos **DEBEN** poder marcarse como **resueltos** y volver a **reabrirse**. Los resueltos se
  ocultan por defecto y se pueden mostrar; resolver no borra nada. Quien resuelve y quien reabre quedan
  registrados.
- **RF-808** — Un comentario inline **DEBE** almacenar, además de su posición: la **cita literal** del
  fragmento anotado y la **versión** del documento en la que se creó. La posición guardada es la de **esa**
  versión y es inmutable como ella: el fragmento anotado nunca cambia bajo el comentario.
- **RF-809** — Mientras haya cambios sin commitear, un hilo de la versión actual **DEBE** seguirse pintando
  sobre la copia de trabajo si su fragmento sigue ahí. Cuando la edición se lo lleve por delante, el hilo
  **DEBE** mostrarse como **huérfano** —no desaparece ni se engancha a un fragmento equivocado, sino que
  permanece accesible en el panel con su cita original—, y **DEBE** volver a su sitio si el texto vuelve. Este
  estado es de la copia de trabajo, nunca de la versión: sobre su propia versión el ancla siempre es exacta.
- **RF-810** — La ficha de la app **DEBE** ofrecer un **panel lateral** con todos los hilos inline (activos,
  resueltos y huérfanos), y navegar desde un hilo hasta su fragmento en el documento.
- **RF-811** — El listado de apps y la ficha **DEBERÍAN** mostrar el número de hilos abiertos, de cualquier
  versión: lo que dice es que hay algo esperando respuesta.
- **RF-817** — Un hilo inline pertenece a la **versión sobre la que se escribió** (RF-808). La ficha **DEBE**
  mostrar solo los hilos de la versión que se está mirando, **DEBE** impedir comentar sobre versiones que no
  son la actual —lo escrito quedaría anclado a un texto que ya nadie ve— y **DEBE** permitir seguir
  resolviendo y reabriendo los de versiones anteriores. Los hilos abiertos que queden atrás **DEBEN**
  anunciarse desde la versión actual, con un camino para llegar a ellos.
- **RF-812** — Archivar una app **DEBE** dejar sus comentarios en sólo lectura. Eliminar una app **DEBE**
  eliminar sus comentarios.
- **RF-813** — Los comentarios **DEBEN** conservar la autoría aunque su autor sea expulsado del workspace o
  desactivado.
- **RF-814** — Un comentario **DEBE** admitir **menciones** con la sintaxis `@handle` (RF-208). Una mención
  genera notificación para el mencionado (RF-910) y se muestra resaltada y enlazada a su perfil.
- **RF-815** — El autocompletado de menciones **DEBE** limitarse a los **miembros del workspace** de la app.
  Mencionar a alguien ajeno al workspace no le da acceso ni le notifica, y el buscador **NO DEBE** revelar la
  existencia de usuarios fuera de él (coherente con RF-312).
- **RF-816** — Si el mencionado pierde después el acceso al workspace, la mención **DEBE** seguir visible en el
  texto del comentario, pero deja de enlazar a nada que él pueda abrir.

### 5.9 Notificaciones

- **RF-901** — La aplicación **DEBE** ofrecer un **centro de notificaciones dentro de la propia app**, con
  contador de no leídas siempre visible.
- **RF-902** — **DEBEN** generar notificación, como mínimo: te han invitado a un workspace; alguien ha
  comentado una app de la que eres precursor o contribuidor; alguien ha respondido en un hilo en el que
  participas; alguien ha resuelto un hilo tuyo; se ha guardado una versión nueva de una app donde contribuyes;
  te han transferido el rol de precursor; has heredado apps al salir alguien del workspace (RF-413).
- **RF-903** — El usuario **DEBE** poder marcar notificaciones como leídas, individualmente y todas a la vez.
- **RF-904** — Al pulsar una notificación **DEBE** navegarse al recurso concreto: la app, el hilo o el
  workspace correspondiente.
- **RF-905** — Un usuario **NO DEBE** recibir notificaciones de sus propias acciones.
- **RF-906** — Las notificaciones **DEBEN** respetar los permisos: si el usuario pierde el acceso al recurso,
  la notificación deja de ser accesible.
- **RF-907** — En v1 **no** hay notificaciones por email (RF-311). El diseño **DEBERÍA** permitir añadir ese
  canal después sin rehacer el modelo.
- **RF-908** — Ser **mencionado** en un comentario **DEBE** generar notificación, aunque no seas precursor ni
  contribuidor de esa app, siempre que seas miembro del workspace (RF-815).
- **RF-909** — El usuario **DEBE** poder **purgar** sus notificaciones: borrar una concreta y vaciar todas las
  leídas de una vez.
- **RF-910** — El sistema **DEBE** purgar automáticamente las notificaciones para que no crezcan sin límite:
  se eliminan las **leídas** transcurrido un plazo configurable, y se conserva como máximo un número acotado
  por usuario, descartando primero las más antiguas. Ambos valores son configuración de instancia.
- **RF-911** — La purga, manual o automática, **NO** afecta al contenido: borrar una notificación no borra el
  comentario, la versión ni el evento de auditoría al que apuntaba.

---

## 6. Requerimientos no funcionales

### 6.1 Seguridad

- **RNF-101** — Toda la autorización **DEBE** aplicarse en el servidor. Ocultar un botón no es control de
  acceso.
- **RNF-102** — Cada endpoint **DEBE** resolver, antes de leer o escribir: pertenencia al workspace, rol en él
  y nivel de acceso de la app.
- **RNF-103** — Toda consulta de datos **DEBE** estar acotada por workspace desde el propio acceso a datos, no
  solo por filtros de la capa superior: el aislamiento entre workspaces es el invariante de seguridad más
  importante del sistema.
- **RNF-104** — Protección CSRF en todas las operaciones que cambian estado.
- **RNF-105** — El flujo OAuth **DEBE** validar el parámetro `state` y usar PKCE.
- **RNF-112** — Ningún dato sensible **DEBE** aparecer en logs, trazas, métricas ni registro de auditoría:
  tokens, cookies, contenido de documentos y texto de comentarios quedan fuera por diseño (RF-706).
- **RNF-111** — Los permisos solicitados a GitHub en v1 **DEBEN** ser los mínimos para identificar al usuario
  (perfil público y email verificado). No se piden permisos sobre repositorios hasta que la fase 3 lo requiera,
  y entonces **DEBERÁN** pedirse de forma incremental y explicada.
- **RNF-106** — Los secretos (client secrets, claves de firma, credenciales de BD) **NO** pueden estar en el
  repositorio: se inyectan por entorno.
- **RNF-107** — Toda entrada se valida y se sanea; las consultas usan parámetros, nunca concatenación.
- **RNF-108** — En cloud, todo el tráfico **DEBE** ir sobre HTTPS.
- **RNF-109** — Al ser el registro abierto, los endpoints de alta, login e invitación **DEBEN** tener límite de
  tasa.
- **RNF-110** — Los identificadores de recurso en URL **DEBERÍAN** ser no adivinables, para no exponer volumen
  ni permitir enumeración.

### 6.2 Rendimiento y escala esperada

- **RNF-201** — Dimensionado de v1: decenas de usuarios y cientos de apps.
- **RNF-202** — Listado y ficha **DEBERÍAN** responder por debajo de 300 ms en local con datos representativos.

### 6.3 Operación

- **RNF-301** — La instancia completa **DEBE** levantarse en local con un único comando documentado.
- **RNF-302** — El esquema **DEBE** gestionarse con migraciones versionadas.
- **RNF-303** — **DEBE** existir un *seed* de datos de ejemplo, con al menos dos usuarios y un workspace
  compartido, para probar el modelo de permisos.
- **RNF-304** — La configuración **DEBE** venir de variables de entorno, con `.env.example` documentado.
- **RNF-305** — Ninguna decisión de v1 debe impedir el despliegue en cloud: sin estado en el sistema de
  ficheros local para datos de negocio.

### 6.4 Calidad

- **RNF-401** — La lógica de permisos (aislamiento entre workspaces y niveles de acceso) y el versionado de
  documentos **DEBEN** tener tests automatizados, incluyendo casos negativos explícitos.
- **RNF-402** — **DEBERÍA** existir un test end-to-end del flujo principal: alta → crear app → compartir →
  invitar → editar como invitado → ver historial.
- **RNF-403** — El código **DEBE** pasar linter y comprobación de tipos antes de considerarse terminado.

### 6.5 Accesibilidad e idioma

- **RNF-501** — La interfaz **DEBERÍA** cumplir WCAG 2.1 nivel AA en contraste, foco visible y navegación por
  teclado.
- **RNF-502** — La interfaz de v1 se entrega **en inglés**, con los textos centralizados para no bloquear la
  internacionalización futura. La documentación del proyecto se mantiene en español; los identificadores,
  enums y el código van en inglés.

---

## 7. Criterios de aceptación de la v1

La v1 está terminada cuando, en una instancia local:

1. Una persona sin cuenta entra con GitHub, queda dentro y ve su workspace personal recién creado y vacío, con
   su nombre de usuario de GitHub ya como handle.
2. Crea una app en menos de un minuto partiendo de la plantilla de visión; nace privada.
3. Un segundo usuario se da de alta y **no** ve nada del primero, ni por listado ni por URL directa.
4. El primero invita al segundo por email a su workspace; el segundo lo ve en su selector de workspaces.
5. Estando invitado, el segundo **no** ve las apps privadas del primero.
6. El primero pasa una app a `WORKSPACE_READ`: el segundo la lee pero no puede editarla.
7. El primero la pasa a `WORKSPACE_WRITE`: el segundo la edita y su versión queda atribuida a él, y aparece
   como contribuidor en la ficha sin que nadie le haya dado ese rol.
8. El segundo crea una app propia dentro del workspace del primero: nace en `WORKSPACE_WRITE`, la UI se lo
   advierte, no le ofrece hacerla privada, y el primero la ve y la puede editar.
9. El historial muestra todas las versiones con autor y fecha; el diff entre dos es correcto; restaurar genera
   una versión nueva sin perder las anteriores.
10. Dos usuarios editando a la vez no se pisan: el segundo guardado recibe aviso de conflicto.
11. Cualquiera que pueda leer descarga un `VISION.md` con el contenido actual y su cabecera de metadatos.
12. El primero expulsa al segundo; éste deja de ver el workspace de inmediato, la app que había creado sigue
    ahí con el primero como precursor, y sus versiones siguen atribuidas a él en el historial.
13. Un `ADMIN` lista usuarios, desactiva una cuenta y comprueba que pierde el acceso — y **no** encuentra en
    ninguna pantalla el contenido de un workspace del que no es miembro.
14. Un lector de una app en `WORKSPACE_READ`, que no puede editarla, **sí** puede comentarla: escribe en el
    hilo general, selecciona un fragmento y deja un comentario inline, y otro usuario le responde.
15. El precursor edita la visión y borra el fragmento anotado: el hilo inline no desaparece, aparece como
    huérfano en el panel lateral conservando su cita original.
16. Un hilo se marca como resuelto, deja de mostrarse por defecto, se recupera y se **reabre**.
17. Al escribir `@` en un comentario solo se ofrecen miembros de ese workspace; el mencionado recibe su
    notificación aunque no fuera contribuidor de la app.
18. Un usuario vacía sus notificaciones leídas y comprueba que los comentarios y versiones a los que apuntaban
    siguen intactos.
19. Al comentar, el precursor recibe una notificación en la campana, que le lleva directamente al hilo; quien
    comentó no recibe notificación de su propio comentario.
20. Una app recién creada muestra un icono por defecto distinto del de sus vecinas, y su precursor lo cambia
    eligiendo emoji y color de la selección curada.
21. Una app guarda un enlace a un repositorio de GitHub y lo muestra en la ficha, sin que ello traiga ningún
    dato externo.
22. La aplicación se levanta desde cero con el comando documentado y datos de ejemplo.

---

## 8. Restricciones de diseño (para que el futuro no duela)

- **RD-1 — Núcleo agnóstico.** La lógica de dominio (workspaces, apps, documentos, versiones, permisos) debe
  estar separada de la capa web y de la de persistencia, para poder invocarse desde otra superficie —un
  servidor MCP, por ejemplo— sin duplicar reglas de negocio ni de autorización.
- **RD-2 — Puntos de extensión previstos.** Aunque no haya runtime de plugins en v1, el modelo debe anticipar
  que una app tenga *integraciones externas* asociadas y *métricas* de origen externo, y que la ficha de app
  pueda incorporar secciones aportadas por ellas.
- **RD-3 — Eventos de dominio.** Las operaciones relevantes deberían emitir eventos internos (ya usados por la
  auditoría en v1) que en el futuro puedan consumir plugins.
- **RD-4 — Documentos genéricos.** El almacenamiento se modela por tipo desde el principio (RF-514), para que
  añadir PRD y TRD sea añadir un tipo, no rehacer el modelo.
- **RD-5 — Workspaces de primera clase.** El workspace es una entidad con dueño y miembros, no un sinónimo del
  usuario. En v1 solo existe el personal, pero cualquier miembro ya crea apps en él: un workspace de equipo o
  de empresa será el mismo modelo con más roles, no un rediseño.
- **RD-6 — Aislamiento como invariante.** El acceso a datos debe estar acotado por workspace en su nivel más
  bajo (RNF-103), de modo que un olvido en una consulta no filtre datos entre workspaces.
- **RD-7 — Sin estado local.** Nada de datos de negocio en el sistema de ficheros del servidor.

---

## 9. Fuera de alcance de v1 — dirección del producto

### Fase 2 — Arquitectura de plugins
Contrato de plugin claro, registro y activación por instancia y por workspace, configuración y credenciales por
plugin, y puntos de extensión en modelo de datos, API y UI. Los plugins de la fase 3 serán la primera prueba
real de que el contrato funciona.

### Fase 3 — Integraciones de datos externos
- **GitHub:** integración real sobre el enlace ya guardado en v1 (RF-417): releases y versiones, KPIs
  (estrellas, forks, clones, issues, actividad de commits), **webhooks** para reaccionar a eventos del
  repositorio y **acciones** ejecutables desde App Foundry.
- **Tiendas:** App Store Connect y Google Play para KPIs de distribución (descargas, valoraciones, reseñas,
  crashes).
- Visualización de esos KPIs en la ficha de la app y su evolución en el tiempo.

> Al ser GitHub el proveedor de identidad (D-22), esta fase parte con ventaja: la cuenta ya está vinculada y
> solo hay que ampliar permisos de forma incremental (RNF-111).

### Fase 4 — Servidor MCP
Exponer App Foundry como servidor MCP para operarla desde un agente: crear apps, leer y refinar el `VISION.md`
y futuros documentos, y accionar el resto de capacidades. Requiere resolver la autenticación del agente y su
alcance por workspace con el mismo modelo de permisos que la UI (RD-1).

### Fase 5 — Cadena de especificación completa
PRDs derivados de la visión, TRDs derivados de los PRDs y tareas derivadas de los TRDs, con trazabilidad entre
niveles.

### Fase 6 — SaaS en cloud
Despliegue gestionado, workspaces de equipo, planes y facturación, y endurecimiento del aislamiento entre
clientes.

---

## 10. Decisiones tomadas

| # | Decisión | Motivo |
|---|---|---|
| D-1 | La v1 cubre **solo el core**: alta, workspaces, apps, visión versionada y UI. | Llegar antes a algo usable; plugins y MCP se apoyarán en un núcleo sólido. |
| D-2 | El markdown vive en **base de datos con historial de versiones**, exportable a `.md`. | Simplifica despliegue y multiusuario, y encaja con el SaaS futuro. |
| D-3 | **Un workspace por usuario**, creado automáticamente al darse de alta, como entidad de primera clase. | Cada usuario aterriza en un espacio propio; evita el refactor de multi-tenancy más adelante. |
| D-4 | **Se invita al workspace, nunca a una app.** Cualquier miembro crea apps; solo el dueño invita, expulsa y renombra. | Una única frontera de permisos, y la transición a workspaces de equipo o de empresa deja de ser un refactor. |
| D-5 | La app tiene **tres niveles de acceso**: privada, lectura de workspace y edición de workspace. | Da control por idea sin necesidad de gestionar membresías app por app. |
| D-9 | Lo que un invitado crea en un workspace ajeno **nace y permanece en `WORKSPACE_WRITE`**. | Nadie usa el espacio de otro como cajón privado, y el dueño no se encuentra contenido opaco en su propio workspace. |
| D-10 | Si el precursor deja el workspace, **la app se queda y el dueño hereda el rol**. | La app pertenece al espacio, no a la persona; se evitan apps huérfanas sin perder la atribución del historial. |
| D-11 | La interfaz va **en inglés**; la documentación, en español. | Es la lengua franca del producto y del código, y la plataforma aspira a ser un SaaS. |
| D-12 | **Comentar solo requiere permiso de lectura**, e incluye hilo general e inline. | Compartir una idea es pedir opinión: dejar sin voz a quien solo puede leer vaciaría de sentido el nivel `WORKSPACE_READ`. |
| D-13 | Un comentario inline guarda **cita y versión**, y pasa a **huérfano** si su ancla desaparece. | Perder feedback o anclarlo al fragmento equivocado es peor que mostrarlo descolgado con su contexto original. |
| D-14 | El icono es **emoji más color**, con uno por defecto determinista. | Da identidad visual al listado sin meter almacenamiento de ficheros en v1 (RD-7). |
| D-15 | El **enlace a GitHub entra en v1** como campo opcional e informativo. | Cuesta casi nada, ya recoge el dato y deja preparado el anclaje de la integración real de la fase 3. |
| D-16 | **Notificaciones dentro de la app, sin email.** | Con comentarios en v1, un aviso que nadie ve convierte la conversación en un buzón muerto; el correo añade infraestructura que no toca todavía. |
| D-17 | El **handle** es el nombre de usuario de GitHub; la identidad de la cuenta es el **id numérico** de GitHub. | Único por construcción y ya familiar para el usuario; el id numérico sobrevive a que cambie su username o su email. |
| D-18 | Las menciones se limitan a **miembros del workspace**. | Mencionar no puede ser una vía para descubrir quién más usa la plataforma ni para dar acceso por la puerta de atrás. |
| D-19 | Las notificaciones se **purgan**, manual y automáticamente, con límites de instancia. | Un buzón que solo crece deja de leerse y engorda la base de datos sin aportar nada. |
| D-20 | Los hilos resueltos se pueden **reabrir**; el emoji del icono sale de una **selección curada**. | Una conversación puede volver a estar viva; y una lista corta de emojis se elige más rápido y mantiene coherencia visual. |
| D-21 | Los **comentarios inline se mantienen en v1**, pese al alcance. | Es la funcionalidad que convierte el refinamiento de una visión en una conversación real sobre el texto, no un chat al margen. |
| D-6 | El **admin de plataforma gestiona cuentas, no contenido**. | Único modelo defendible el día que esto sea un SaaS multi-cliente. |
| D-7 | **Registro abierto** por OAuth, sin allowlist ni aprobación. | Con workspace propio, quien entra no ve nada de nadie: la fricción sobra. |
| D-22 | **GitHub como único proveedor de identidad.** | Un solo flujo que mantener y probar; el público objetivo ya tiene cuenta; y la identidad y el token quedan listos para la integración real con repositorios de la fase 3. |
| D-8 | **Contribuidor es un rol derivado** del historial de versiones, no algo que se concede. | Preserva el modelo precursor/contribuidores sin gestión manual de permisos. |

---

## 11. Preguntas abiertas

No queda ninguna pregunta abierta de producto: todas las decisiones están recogidas en la sección 10 y
reflejadas en los requisitos. Lo que queda por resolver es técnico y corresponde al TRD:

- Elección de stack, base de datos y estrategia de despliegue local.
- Cómo se registra la aplicación OAuth de GitHub para desarrollo local y qué scopes se piden (RNF-111).
- Modelo de datos concreto y cómo se garantiza el aislamiento por workspace (RNF-103, RD-6).
- Mecanismo de anclaje y reanclaje de los comentarios inline sobre un markdown que cambia (RF-808, RF-809).
- Estrategia de diff entre versiones y de detección de conflictos (RF-508, RF-511).
- Composición de la selección curada de emojis y de la paleta de colores (RF-416).

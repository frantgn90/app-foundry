import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ConflictError,
  type SaveConflict,
  useApp,
  useCommitDocument,
  useCreateThread,
  useDeleteComment,
  useDeleteThread,
  useDocument,
  useMentionable,
  useReply,
  useResetDocument,
  useResolveThread,
  useRestoreVersion,
  useSaveDocument,
  useAiTaskAvailable,
  useThreads,
  useVersionContent,
  useVersions,
} from '../lib/api.js';
import {
  type AssistAction,
  ASSIST_ACTIONS,
  ASSIST_LABELS,
  estimateAssist,
  streamAssist,
} from '../lib/assist.js';
import {
  AssistEstimatePrompt,
  AssistProposal,
  type AssistState,
} from '../components/assist-proposal.js';
import { CommentsPanel } from '../components/comments-panel.js';
import { type AnchorRange, paintAnchors, paintPending, sourceOffsetAt } from '../lib/highlight.js';
import { SelectionMenu } from '../components/selection-menu.js';
import { resolveSelection, selectionRect, type SourceSelection } from '../lib/selection.js';
import { MentionInput } from '../components/mention-input.js';
import { AppSettingsPage } from './app-settings.js';
import { DiffView } from '../components/diff-view.js';
import { MarkdownEditor } from '../components/editor.js';
import { EditToggle, VersionPicker } from '../components/vision-controls.js';
import { Markdown } from '../components/markdown.js';
import { TagList } from '../components/app-status.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { useShortcuts } from '../lib/shortcuts.js';
import { cn } from '../lib/utils.js';

type Tab = 'vision' | 'settings';

/** Clave del borrador local, por app: no se mezclan entre sí (RF-506). */
const draftKey = (appId: string) => `app-foundry:draft:${appId}`;

export function AppDetailPage({
  appId,
  workspaceId,
  initialThreadId = null,
  onBack,
}: {
  appId: string;
  workspaceId: string;
  /** Hilo al que ir nada más abrir, cuando se llega desde un aviso (RF-904). */
  initialThreadId?: string | null;
  onBack: () => void;
}) {
  const app = useApp(appId);
  const document = useDocument(appId);
  const versions = useVersions(appId);
  const save = useSaveDocument(appId);
  const commit = useCommitDocument(appId);
  const reset = useResetDocument(appId);
  const restore = useRestoreVersion(appId);

  const [tab, setTab] = useState<Tab>('vision');
  /*
   * Leer y escribir dejan de ser sitios distintos y pasan a ser un interruptor
   * sobre el mismo documento: se puede pasar de uno a otro sin perder de vista
   * dónde se estaba. Leer muestra el texto compuesto; escribir, el markdown.
   */
  const [editando, setEditando] = useState(false);
  /*
   * La conversación se puede plegar hacia la derecha. Escribir a media pantalla
   * incomoda, y hay ratos en que la conversación no hace falta delante; el
   * contador en el botón evita que se olvide que sigue ahí.
   */
  const [conversacionAbierta, setConversacionAbierta] = useState(true);
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  /*
   * Versión que se está mirando, `null` mientras sea la actual. El historial
   * dejó de ser una pestaña: se elige aquí y el documento de debajo cambia.
   */
  const [versionElegida, setVersionElegida] = useState<string | null>(null);
  const [mostrandoDiff, setMostrandoDiff] = useState(false);
  /*
   * Commitear pide mensaje y descartar pide confirmación, y las dos cosas se
   * preguntan donde está el botón en vez de en un diálogo aparte: lo que se va
   * a versionar —o a perder— sigue delante mientras se decide.
   */
  const [commiteando, setCommiteando] = useState(false);
  const [mensajeCommit, setMensajeCommit] = useState('');
  const [descartando, setDescartando] = useState(false);
  const [selectedThread, setSelectedThread] = useState<string | null>(initialThreadId);
  // Solo se hace scroll cuando el hilo se elige desde el panel; al pinchar en el
  // texto ya se está mirando el sitio.
  const [scrollToThread, setScrollToThread] = useState(initialThreadId !== null);
  /*
   * Llegar desde un aviso a una app que ya estaba abierta también tiene que
   * llevar al hilo: sin esto, el segundo aviso de la misma app no movería nada,
   * porque el estado inicial ya se fijó al montar.
   */
  useEffect(() => {
    if (initialThreadId === null) return;
    setSelectedThread(initialThreadId);
    setScrollToThread(true);
    setTab('vision');
  }, [initialThreadId]);

  // La selección pendiente se guarda al soltar el ratón, pero el formulario no
  // se abre hasta que se pulsa el botón del menú: seleccionar texto no es
  // decidir comentarlo.
  const [pendingSelection, setPendingSelection] = useState<SourceSelection | null>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  /*
   * La propuesta del asistente, mientras la haya. Nunca se aplica sola: se lee
   * como diff y se acepta o se descarta (RF-1403, RF-1404).
   */
  const [assist, setAssist] = useState<AssistState | null>(null);
  /* El techo de tokens de una acción sobre el documento entero (RF-1412). */
  const [estimacion, setEstimacion] = useState<{
    action: AssistAction;
    tokens: number | null;
  } | null>(null);
  /*
   * Con qué cortar la generación. Descartar no es dejar de mirar: aborta la
   * petición, y el servidor aborta con ella la llamada al proveedor.
   */
  const abortRef = useRef<AbortController | null>(null);
  const [composing, setComposing] = useState(false);
  /* Si la IA se puede ofrecer aquí y ahora; si no, no aparece nada (RF-1010). */
  const iaDisponible = useAiTaskAvailable(workspaceId, 'TEXT_ASSIST');
  const [selectionDraft, setSelectionDraft] = useState('');
  const readingRef = useRef<HTMLDivElement>(null);

  /*
   * Guardar con el teclado vale en toda la pestaña, no solo con el foco dentro
   * del editor: si no, hacer clic fuera y pulsar Mod-S abriría el diálogo de
   * guardar página del navegador, que no es lo que nadie quiere ahí.
   *
   * Va aquí arriba, con el resto de hooks y antes de cualquier salida
   * anticipada: más abajo, el primer render —el de «cargando»— tendría menos
   * hooks que el siguiente y React abortaría el componente entero. Se ve solo al
   * abrir una app que no esté ya en memoria, que es justo lo que no se prueba
   * abriendo dos veces la misma.
   */
  const guardarConTeclado = useRef<() => void>(() => undefined);
  useShortcuts(
    useMemo(
      () => [
        {
          tecla: 's',
          conModificador: true,
          aunEscribiendo: true,
          hacer: () => {
            guardarConTeclado.current();
          },
        },
      ],
      [],
    ),
  );

  /*
   * Booleana y no el objeto: `assist` cambia con cada trozo que llega, y un
   * efecto que dependiera de él se desengancharía y volvería a engancharse
   * decenas de veces por respuesta.
   */
  const asistiendo = assist !== null;

  const elegida = useVersionContent(appId, versionElegida);
  /*
   * Los hilos son los de lo que se está mirando (RF-817): sin versión elegida,
   * los de la copia de trabajo; con ella, los de esa versión.
   */
  const threads = useThreads(appId, versionElegida);
  const people = useMentionable(appId);
  const createThread = useCreateThread(appId);
  const reply = useReply(appId);
  const resolveThread = useResolveThread(appId);
  const deleteThread = useDeleteThread(appId);
  const deleteComment = useDeleteComment(appId);

  // Al elegir un hilo se resalta su fragmento en el documento y se lleva a la
  // vista: es la mitad de la navegación entre panel y texto (RF-810).
  /*
   * Todos los fragmentos con conversación abierta se pintan, no solo el elegido:
   * si no, la conversación existente sería invisible hasta abrir el panel
   * (RF-810).
   *
   * Los hilos resueltos se quedan fuera a propósito. Se resuelven precisamente
   * porque ya no hay nada que hacer con ellos, y son la parte de la lista que
   * crece sin parar: un documento con meses de historia acabaría subrayado de
   * punta a punta y el resaltado dejaría de señalar nada. Siguen en el panel, y
   * reabrir uno lo devuelve al documento.
   */
  const anchorRanges: AnchorRange[] = (threads.data?.threads ?? [])
    .filter(
      (t) =>
        t.status === 'OPEN' &&
        t.anchorStatus === 'ANCHORED' &&
        t.anchorStart !== null &&
        t.anchorEnd !== null,
    )
    .map((t) => ({ threadId: t.id, start: t.anchorStart ?? 0, end: t.anchorEnd ?? 0 }));

  const anchorsKey = anchorRanges.map((a) => `${a.threadId}:${String(a.start)}`).join('|');

  /*
   * Todo el resaltado se pinta de una vez y en el mismo efecto.
   *
   * Los rangos de la Custom Highlight API apuntan a nodos concretos del DOM, así
   * que cualquier cosa que rehaga el documento los deja apuntando a nodos que ya
   * no están: el resaltado sigue registrado pero no pinta nada, y no salta
   * ningún error. Intentar cubrirlo enumerando dependencias no funcionó —
   * siempre aparecía otra cosa que rehacía el documento sin cambiar ninguna de
   * ellas, como desplegar los hilos resueltos en el panel de al lado.
   *
   * Así que en vez de adivinar qué provoca el re-render, se observa el resultado
   * y se repinta. Resaltar no modifica el DOM (de eso trata precisamente esta
   * API), así que el observador no puede dispararse a sí mismo.
   */
  /**
   * El menú aparece cuando **termina** el gesto, no mientras se hace.
   *
   * Esto empezó escuchando el cambio de selección, y era un error: ese evento se
   * dispara continuamente mientras se arrastra, así que cada fotograma
   * provocaba estado nuevo, un render y un repintado del resaltado **encima de
   * una selección que el usuario todavía estaba haciendo**. El resultado era una
   * selección errática, que es exactamente lo que no puede pasar: seleccionar
   * texto tiene que comportarse como en cualquier página, sin que la aplicación
   * se meta por medio.
   *
   * Escuchando el final del gesto se cubren los cuatro casos que fallaban
   * —doble clic, triple clic, teclado y arrastres que terminan fuera del
   * texto— sin tocar nada mientras dura (RF-1415).
   */
  useEffect(() => {
    const contenedor = readingRef.current;
    /*
     * Mientras se escribe el comentario no se toca la selección pendiente:
     * pulsar en la caja de texto la colapsa, y perderla ahí dejaría el
     * comentario sin ancla justo al ir a escribirlo.
     */
    if (!contenedor || editando || versionElegida !== null || composing || asistiendo) return;

    const mirar = () => {
      const contenido = document.data?.content;
      if (!contenido) return;

      const seleccion = resolveSelection(contenido, contenedor);
      if (!seleccion) {
        setPendingSelection(null);
        setMenuRect(null);
        return;
      }
      setPendingSelection(seleccion);
      setMenuRect(selectionRect(contenedor));
    };

    /*
     * Se mira un instante **después** del evento, no dentro de él.
     *
     * Durante `pointerup` la selección todavía es la de antes: al pulsar fuera
     * del texto para quitarla, el navegador no la ha deshecho aún, así que
     * preguntarle ahí devuelve lo que ya no está marcado y el menú se quedaba
     * puesto. Un turno del bucle de eventos basta; ni se ve.
     */
    let pendiente: number | undefined;
    const alTerminar = () => {
      window.clearTimeout(pendiente);
      pendiente = window.setTimeout(mirar, 0);
    };

    /*
     * `pointerup` cubre ratón y táctil, y va en el documento y no en el
     * contenedor para no perderse los arrastres que terminan fuera del texto.
     * `keyup` cubre la selección con teclado, que no tiene puntero ninguno.
     */
    window.document.addEventListener('pointerup', alTerminar);
    window.document.addEventListener('keyup', alTerminar);
    return () => {
      window.clearTimeout(pendiente);
      window.document.removeEventListener('pointerup', alTerminar);
      window.document.removeEventListener('keyup', alTerminar);
    };
  }, [editando, versionElegida, composing, asistiendo, document.data?.content]);

  useEffect(() => {
    const contenedor = readingRef.current;

    const pintar = () => {
      paintAnchors(contenedor, anchorRanges, selectedThread, {
        scrollToActive: scrollToThread,
      });
      paintPending(contenedor, pendingSelection);
    };

    pintar();
    if (scrollToThread) setScrollToThread(false);

    if (!contenedor) return;
    // El scroll solo se hace en el pintado inicial: repetirlo en cada mutación
    // movería la página bajo los pies de quien está leyendo.
    const observador = new MutationObserver(() => {
      paintAnchors(contenedor, anchorRanges, selectedThread, { scrollToActive: false });
      paintPending(contenedor, pendingSelection);
    });
    observador.observe(contenedor, { childList: true, subtree: true, characterData: true });
    return () => {
      observador.disconnect();
    };
    // `anchorsKey` resume la lista de anclas, que se reconstruye en cada render.
  }, [
    anchorsKey,
    selectedThread,
    pendingSelection,
    tab,
    editando,
    versionElegida,
    mostrandoDiff,
    scrollToThread,
    document.data?.content,
    // El texto de una versión llega después de elegirla, y con él el contenedor
    // sobre el que hay que pintar.
    elegida.data?.content,
  ]);

  // Borrador local: cerrar la pestaña a media edición no debería perder el
  // texto. No genera versiones, solo sobrevive a un accidente (RF-506).
  useEffect(() => {
    if (draft === null || !document.data) return;
    if (draft === document.data.content) {
      localStorage.removeItem(draftKey(appId));
      return;
    }
    localStorage.setItem(draftKey(appId), draft);
  }, [draft, appId, document.data]);

  useEffect(() => {
    if (!document.data || draft !== null) return;
    const saved = localStorage.getItem(draftKey(appId));
    setDraft(saved ?? document.data.content);
    // Si había borrador sin guardar, se vuelve a donde se estaba escribiendo.
    if (saved && saved !== document.data.content) setEditando(true);
  }, [document.data, draft, appId]);

  if (app.isPending || document.isPending) {
    return <p className="text-sm text-[var(--color-texto-suave)]">Loading…</p>;
  }
  if (!app.data || !document.data) {
    return <p className="text-sm">This app could not be loaded.</p>;
  }

  const content = draft ?? document.data.content;

  const openThreads = (threads.data?.threads ?? []).filter((t) => t.status === 'OPEN').length;
  const hasUnsavedChanges = content !== document.data.content;
  const sinCommitear = document.data.uncommittedChanges;
  const mirandoCopiaDeTrabajo = versionElegida === null;

  function postInlineComment() {
    if (!pendingSelection || !selectionDraft.trim()) return;
    createThread.mutate(
      {
        body: selectionDraft.trim(),
        quote: pendingSelection.quote,
        start: pendingSelection.start,
        end: pendingSelection.end,
        // El hilo pertenece a la versión actual, aunque se escriba sobre la
        // copia de trabajo: el servidor rechaza cualquier otra (RF-817).
        ...(document.data?.currentVersionId ? { versionId: document.data.currentVersionId } : {}),
      },
      {
        onSuccess: () => {
          setPendingSelection(null);
          setSelectionDraft('');
          setComposing(false);
        },
      },
    );
  }

  /**
   * Pide una reescritura y va recogiendo lo que llega (RF-1401, RF-1407).
   *
   * Lo que se manda son **posiciones del fuente** y la revisión desde la que se
   * miran. Con eso, si alguien guarda mientras el modelo escribe, aceptar la
   * propuesta se rechaza en vez de aplicarla sobre otro texto (RF-1408).
   */
  function pedirAsistencia(action: AssistAction, scope: 'SELECTION' | 'DOCUMENT') {
    if (!document.data) return;

    const base = document.data.content;
    const start = scope === 'DOCUMENT' ? 0 : (pendingSelection?.start ?? 0);
    const end = scope === 'DOCUMENT' ? base.length : (pendingSelection?.end ?? 0);
    const revision = document.data.revision;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setMenuRect(null);
    setEstimacion(null);
    setAssist({
      action,
      scope,
      base,
      start,
      end,
      revision,
      original: base.slice(start, end),
      propuesta: '',
      razonamiento: '',
      pensando: false,
      meta: null,
      generando: true,
      error: null,
    });

    /*
     * Cada respuesta solo escribe en el estado mientras siga siendo la suya: al
     * pedir otra, la anterior se aborta, pero puede tener trozos ya en camino y
     * mezclarlos dejaría dos propuestas escritas una encima de otra.
     */
    const vigente = () => abortRef.current === abort;

    void streamAssist(
      appId,
      {
        action,
        scope,
        ...(scope === 'SELECTION' ? { start, end } : {}),
        revision,
      },
      {
        onMeta: (meta) => {
          setAssist((previo) => (previo && vigente() ? { ...previo, meta } : previo));
        },
        onDelta: (text) => {
          setAssist((previo) =>
            previo && vigente() ? { ...previo, propuesta: previo.propuesta + text } : previo,
          );
        },
        onReasoning: (text) => {
          setAssist((previo) =>
            previo && vigente() ? { ...previo, razonamiento: previo.razonamiento + text } : previo,
          );
        },
        onThinking: (active) => {
          setAssist((previo) => (previo && vigente() ? { ...previo, pensando: active } : previo));
        },
        onDone: () => {
          setAssist((previo) => (previo && vigente() ? { ...previo, generando: false } : previo));
        },
        onError: (message) => {
          setAssist((previo) =>
            previo && vigente() ? { ...previo, generando: false, error: message } : previo,
          );
        },
      },
      abort.signal,
    );
  }

  /**
   * Lo que costaría rehacer el documento entero, antes de pedirlo (RF-1412).
   *
   * Es la operación más cara del producto y la única cuyo tamaño no se ve de un
   * vistazo: sobre una selección, lo que se va a mandar está delante y
   * subrayado.
   */
  function pedirTecho(action: AssistAction) {
    if (!document.data) return;
    setAssist(null);
    setEstimacion({ action, tokens: null });

    estimateAssist(appId, { action, scope: 'DOCUMENT', revision: document.data.revision })
      .then((techo) => {
        setEstimacion((previo) =>
          previo?.action === action ? { action, tokens: techo.estimatedTokens } : previo,
        );
      })
      .catch((error: unknown) => {
        /*
         * Un techo que no se puede calcular casi siempre es un texto que no cabe,
         * y eso se cuenta con el mismo panel que una propuesta fallida: es la
         * misma respuesta —«esto no se puede hacer, y por esto»— en el mismo
         * sitio donde se iba a leer.
         */
        setEstimacion(null);
        setAssist({
          action,
          scope: 'DOCUMENT',
          base: '',
          start: 0,
          end: 0,
          revision: 0,
          original: '',
          propuesta: '',
          razonamiento: '',
          pensando: false,
          meta: null,
          generando: false,
          error: error instanceof Error ? error.message : 'The assistant could not answer.',
        });
      });
  }

  /** Descartar no deja rastro, y corta de verdad lo que se estaba generando (RF-1404). */
  function descartarAsistencia() {
    abortRef.current?.abort();
    abortRef.current = null;
    setAssist(null);
    setEstimacion(null);
    setPendingSelection(null);
  }

  /**
   * Aplica la propuesta a la copia de trabajo (RF-1404, RF-1405).
   *
   * Es un guardado normal: no crea versión, y va con la revisión **desde la que
   * se pidió**, no con la de ahora. Si alguien guardó mientras el modelo
   * escribía, se rechaza y se ofrece ver qué cambió, igual que dos personas
   * editando a la vez (RF-511, RF-1408).
   */
  function aceptarAsistencia() {
    if (!assist || !document.data) return;

    const propuesta = assist.propuesta.trim();
    if (propuesta === '') return;

    /*
     * Se apunta **cuál** se está aceptando, y al terminar solo se retira esa.
     *
     * Guardar tarda —escribe, recoloca anclas y recarga—, y entre que se acepta y
     * el servidor contesta da tiempo de sobra a pedir otra propuesta. Retirando
     * «la que haya» se borraba de la pantalla una recién pedida, y quien la
     * estaba esperando la veía desaparecer sola.
     */
    const aplicada = assist;
    const marcado = pendingSelection;
    const nuevo =
      aplicada.base.slice(0, aplicada.start) + propuesta + aplicada.base.slice(aplicada.end);

    setConflict(null);
    save.mutate(
      { content: nuevo, revision: aplicada.revision },
      {
        onSuccess: (actualizado) => {
          localStorage.removeItem(draftKey(appId));
          setDraft(actualizado.content);
          setAssist((previo) => (previo === aplicada ? null : previo));
          /* El resaltado del fragmento se va con su propuesta, y solo con ella:
             sus posiciones ya no señalan el mismo texto. */
          setPendingSelection((previo) => (previo === marcado ? null : previo));
        },
        onError: (error) => {
          if (error instanceof ConflictError) setConflict(error.detail);
        },
      },
    );
  }

  guardarConTeclado.current = () => {
    if (editando) onSave();
  };

  function onSave() {
    if (!document.data) return;
    setConflict(null);
    save.mutate(
      { content, revision: document.data.revision },
      {
        onSuccess: () => {
          localStorage.removeItem(draftKey(appId));
          setTab('vision');
        },
        onError: (error) => {
          if (error instanceof ConflictError) setConflict(error.detail);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        El nombre sigue siendo el encabezado de esta página aunque se lea en la
        ruta de arriba: de él cuelgan la navegación por encabezados y lo que
        anuncia un lector de pantalla al llegar.
      */}
      <h1 className="sr-only">{app.data.name}</h1>

      <nav className="flex items-center gap-1 border-b border-[var(--color-borde)]">
        {(['vision', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
            }}
            className={cn(
              'relative px-3 py-2 text-sm',
              t === 'vision' ? '' : 'capitalize',
              tab === t
                ? 'font-medium text-[var(--color-texto)]'
                : 'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
            )}
          >
            {t === 'vision' ? 'VISION.md' : t}
            {t === 'vision' && hasUnsavedChanges && ' •'}
            {tab === t && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--color-acento)]" />
            )}
          </button>
        ))}

        {/* Las etiquetas ocupan el hueco que dejan las pestañas, en vez de una
            línea propia: son clasificación, se consultan de reojo y no merecen
            alto de pantalla para ellas solas. */}
        <span className="ml-auto pb-1">
          <TagList tags={app.data.tags} />
        </span>
      </nav>

      {conflict && (
        <ConflictNotice
          conflict={conflict}
          onDismiss={() => {
            setConflict(null);
          }}
        />
      )}

      {tab === 'vision' && (
        /*
         * Las dos vistas comparten la misma rejilla, así que la conversación
         * sigue al lado tanto si se mira el texto compuesto como el original.
         *
         * Las dos cabeceras —los controles a la izquierda, el título de la
         * conversación a la derecha— tienen la misma altura fija, de modo que lo
         * que va debajo empieza al mismo nivel en ambas columnas: el borde
         * superior de la caja y el del primer comentario coinciden.
         */
        <div
          className={cn(
            'grid gap-6',
            conversacionAbierta ? 'lg:grid-cols-[1fr_20rem]' : 'lg:grid-cols-1',
          )}
        >
          <div className="flex flex-col gap-3">
            {/*
              Una sola fila para todo lo que se hace con el documento: el
              historial a la izquierda, editar y descargar como iconos cuadrados
              a la derecha, y la conversación pegada al borde, que es donde está
              el panel que despliega. Todo con el mismo alto.
            */}
            <div className="flex h-8 items-center gap-2">
              {/*
                El historial ocupa la izquierda de esta fila, que antes estaba
                vacía. Mientras se escribe no se enseña: se escribe siempre sobre
                la versión actual, y un desplegable que solo puede decir una cosa
                es un adorno.
              */}
              {!editando && (
                <VersionPicker
                  versions={versions.data ?? []}
                  currentVersionId={document.data.currentVersionId}
                  hayCambios={sinCommitear}
                  workingAuthors={document.data.workingAuthors}
                  elegida={versionElegida}
                  mostrandoDiff={mostrandoDiff}
                  puedeRestaurar={document.data.canEdit}
                  restaurando={restore.isPending}
                  onElegir={(id) => {
                    setVersionElegida(id);
                    setMostrandoDiff(false);
                  }}
                  onDiff={() => {
                    setMostrandoDiff(!mostrandoDiff);
                  }}
                  onRestaurar={() => {
                    if (!versionElegida) return;
                    restore.mutate(versionElegida, {
                      onSuccess: (updated) => {
                        setDraft(updated.content);
                        setVersionElegida(null);
                        setMostrandoDiff(false);
                      },
                    });
                  }}
                />
              )}

              {/* Agrupados y empujados a la derecha: si el desplegar la
                  conversación fuera quien empujara, estos dos saltarían de sitio
                  al plegarla y volverían al desplegarla. */}
              <span className="ml-auto flex items-center gap-2">
                {/*
                  Las mismas acciones, sobre todo el documento (RF-1411). Van
                  aquí y no en el menú de selección por lo evidente: no hay nada
                  seleccionado. Un desplegable y no cinco botones, porque esta
                  fila es de controles y no de acciones destacadas.
                */}
                {iaDisponible && !editando && document.data.canEdit && mirandoCopiaDeTrabajo && (
                  <select
                    aria-label="Rewrite the whole document"
                    value=""
                    /*
                      Mientras se está guardando, no. La revisión que se enviaría
                      es la de antes del guardado, así que la petición se
                      rechazaría por concurrencia consigo misma y el mensaje
                      —«alguien guardó mientras leías»— sería verdad y absurdo a
                      la vez.
                    */
                    disabled={save.isPending}
                    onChange={(e) => {
                      if (e.target.value) pedirTecho(e.target.value as AssistAction);
                    }}
                    className={cn(
                      'h-8 w-36 shrink-0 rounded-lg border px-2 text-xs',
                      'border-[var(--color-borde)] bg-[var(--color-superficie)]',
                      'text-[var(--color-texto-suave)]',
                    )}
                  >
                    <option value="">Rewrite all…</option>
                    {ASSIST_ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {ASSIST_LABELS[action].label}
                      </option>
                    ))}
                  </select>
                )}

                <EditToggle
                  editando={editando}
                  /* Una versión pasada se mira, no se escribe: para cambiarla
                     hay que restaurarla antes, que es lo que deja constancia. */
                  puedeEditar={document.data.canEdit && mirandoCopiaDeTrabajo}
                  razonBloqueo={
                    versionElegida !== null
                      ? 'Restore this version to edit it'
                      : 'You can read this app but not edit it'
                  }
                  onEditando={setEditando}
                />

                <a
                  href={`/api/v1/apps/${appId}/document/export`}
                  title="Download VISION.md"
                  aria-label="Download VISION.md"
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-lg border transition',
                    'border-[var(--color-borde)] bg-[var(--color-superficie)]',
                    'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
                  )}
                >
                  <Descarga />
                </a>
              </span>

              {!conversacionAbierta && (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-sm"
                  onClick={() => {
                    setConversacionAbierta(true);
                  }}
                >
                  Show conversation
                  {openThreads > 0 && ` (${String(openThreads)})`}
                </Button>
              )}
            </div>

            {!mirandoCopiaDeTrabajo ? (
              /*
                Una versión pasada: o su texto, o lo que cambió desde ella hasta
                hoy.

                Lleva el mismo `ref` que la caja de lectura porque sus hilos
                también se subrayan: las anclas de un hilo son las de su versión
                y sobre su propio texto son exactas, así que aquí el resaltado es
                más fiel que en ningún otro sitio. Sin el `ref`, el contenedor
                llegaba vacío al pintado y no se subrayaba nada.

                Lo que no se puede es comentar (RF-817), así que no hay menú de
                selección: solo el camino de vuelta, del fragmento a su hilo.
              */
              <Card
                className="p-6"
                ref={readingRef}
                onMouseUp={(event) => {
                  if (!readingRef.current) return;
                  const offset = sourceOffsetAt(readingRef.current, event.clientX, event.clientY);
                  const hit =
                    offset === null
                      ? undefined
                      : anchorRanges.find((a) => offset >= a.start && offset <= a.end);
                  if (hit) setSelectedThread(hit.threadId);
                }}
              >
                {elegida.isPending && (
                  <p className="text-sm text-[var(--color-texto-suave)]">Loading…</p>
                )}
                {elegida.data &&
                  (mostrandoDiff ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-[var(--color-texto-suave)]">
                        What changed between v{elegida.data.versionNo} and{' '}
                        {sinCommitear
                          ? 'the working copy'
                          : `the current v${String(document.data.versionNo)}`}
                        .
                      </p>
                      <DiffView from={elegida.data.content} to={document.data.content} />
                    </div>
                  ) : (
                    <Markdown content={elegida.data.content} />
                  ))}
              </Card>
            ) : !editando ? (
              <>
                {/*
              Al soltar el ratón se mira si hay una selección utilizable. Si no
              se puede resolver a una posición del markdown, no se ofrece
              comentar: mejor no ofrecerlo que anclar en un sitio inventado.
            */}
                <Card
                  className="p-6"
                  ref={readingRef}
                  onMouseUp={(event) => {
                    /*
                     * Aquí solo queda el camino inverso al del resaltado: un clic
                     * sobre un fragmento comentado lleva a su hilo. De abrir el
                     * menú se encarga el cambio de selección, que también cubre
                     * el doble clic, el teclado y el táctil (RF-1415).
                     */
                    if (!readingRef.current || editando) return;
                    if (!window.getSelection()?.isCollapsed) return;

                    const offset = sourceOffsetAt(readingRef.current, event.clientX, event.clientY);
                    const hit =
                      offset === null
                        ? undefined
                        : anchorRanges.find((a) => offset >= a.start && offset <= a.end);
                    if (hit) setSelectedThread(hit.threadId);
                  }}
                >
                  <Markdown content={document.data.content} />
                </Card>

                {menuRect && pendingSelection && !composing && !assist && (
                  <SelectionMenu
                    rect={menuRect}
                    puedeAsistir={iaDisponible && document.data.canEdit && !save.isPending}
                    onComment={() => {
                      setComposing(true);
                      setMenuRect(null);
                    }}
                    onAssist={(action) => {
                      pedirAsistencia(action, 'SELECTION');
                    }}
                  />
                )}

                {/*
                  El techo primero, la propuesta después, y nunca los dos: son
                  dos momentos del mismo gesto —cuánto va a costar, y qué
                  propone— y verlos a la vez solo dejaría en pantalla una
                  pregunta ya contestada.
                */}
                {estimacion && (
                  <AssistEstimatePrompt
                    action={estimacion.action}
                    tokens={estimacion.tokens}
                    pidiendo={false}
                    onConfirmar={() => {
                      pedirAsistencia(estimacion.action, 'DOCUMENT');
                    }}
                    onCancelar={() => {
                      setEstimacion(null);
                    }}
                  />
                )}

                {assist && (
                  <AssistProposal
                    estado={assist}
                    aplicando={save.isPending}
                    onAceptar={aceptarAsistencia}
                    onDescartar={descartarAsistencia}
                  />
                )}

                {composing && pendingSelection && (
                  <Card className="flex flex-col gap-2 border-[var(--color-acento)]/40 p-4">
                    <p className="text-xs text-[var(--color-texto-suave)]">Commenting on:</p>
                    <blockquote className="border-l-2 border-[var(--color-acento)]/50 pl-2 text-sm italic">
                      {pendingSelection.quote}
                    </blockquote>
                    <MentionInput
                      value={selectionDraft}
                      onChange={setSelectionDraft}
                      onSubmit={() => {
                        postInlineComment();
                      }}
                      people={people.data ?? []}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button onClick={postInlineComment} disabled={!selectionDraft.trim()}>
                        Comment
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setPendingSelection(null);
                          setSelectionDraft('');
                          setComposing(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </Card>
                )}
              </>
            ) : (
              /*
                El mismo editor se use para escribir o solo para mirar: con la
                edición apagada el texto se ve igual, con sus números de línea, y
                solo cambia que no admite teclas. Así pasar de leer a escribir no
                mueve nada de sitio.
              */
              <Card className="px-4">
                <MarkdownEditor
                  value={content}
                  onChange={setDraft}
                  onSave={onSave}
                  disabled={!editando}
                />
              </Card>
            )}
            {/*
          Guardar a la izquierda; commitear y descartar a la derecha, que son las
          dos salidas de lo guardado. La fila aparece también sin estar editando
          mientras haya cambios sin commitear: dejar de escribir no es haber
          terminado, y el trabajo pendiente no puede quedarse sin sus botones.
        */}
            {mirandoCopiaDeTrabajo && (editando || sinCommitear) && (
              <div className="flex flex-col gap-3">
                {descartando && (
                  <DescarteNotice
                    autores={document.data.workingAuthors.map((a) => a.handle)}
                    descartando={reset.isPending}
                    onCancelar={() => {
                      setDescartando(false);
                    }}
                    onDescartar={() => {
                      if (!document.data) return;
                      reset.mutate(
                        { revision: document.data.revision },
                        {
                          onSuccess: (actualizado) => {
                            // El borrador local se va con ellos: si no, el editor
                            // devolvería a la pantalla lo que se acaba de descartar.
                            localStorage.removeItem(draftKey(appId));
                            setDraft(actualizado.content);
                            setDescartando(false);
                          },
                        },
                      );
                    }}
                  />
                )}

                {commiteando && (
                  <CommitForm
                    mensaje={mensajeCommit}
                    onMensaje={setMensajeCommit}
                    commiteando={commit.isPending}
                    onCancelar={() => {
                      setCommiteando(false);
                    }}
                    onCommitear={() => {
                      if (!document.data || !mensajeCommit.trim()) return;
                      commit.mutate(
                        { message: mensajeCommit.trim(), revision: document.data.revision },
                        {
                          onSuccess: () => {
                            setMensajeCommit('');
                            setCommiteando(false);
                          },
                        },
                      );
                    }}
                  />
                )}

                <div className="flex flex-wrap items-center gap-3">
                  {editando && (
                    <>
                      <Button onClick={onSave} disabled={save.isPending || !hasUnsavedChanges}>
                        {save.isPending ? 'Saving…' : 'Save'}
                      </Button>
                      <span className="text-xs text-[var(--color-texto-suave)]">
                        {hasUnsavedChanges ? 'Unsaved changes, kept locally' : 'Everything saved'} ·
                        ⌘S
                      </span>
                    </>
                  )}

                  {sinCommitear && document.data.canEdit && (
                    /*
                      Con una propuesta delante, estas dos no significan nada
                      todavía: hay un cambio a medio decidir, y tanto descartar
                      todo como fijar una versión sería contestar a una pregunta
                      distinta de la que está en pantalla. Se apagan hasta que se
                      acepte o se descarte, y el título dice por qué.
                    */
                    <span className="ml-auto flex items-center gap-2">
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-sm"
                        disabled={asistiendo}
                        title={asistiendo ? 'Accept or discard the proposal first' : undefined}
                        onClick={() => {
                          setDescartando(!descartando);
                          setCommiteando(false);
                        }}
                      >
                        Discard changes
                      </Button>
                      <Button
                        className="px-3 py-1.5 text-sm"
                        disabled={asistiendo}
                        title={asistiendo ? 'Accept or discard the proposal first' : undefined}
                        onClick={() => {
                          setCommiteando(!commiteando);
                          setDescartando(false);
                        }}
                      >
                        Commit…
                      </Button>
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {conversacionAbierta && (
            <CommentsPanel
              onCollapse={() => {
                setConversacionAbierta(false);
              }}
              threads={threads.data?.threads ?? []}
              openElsewhere={threads.data?.openElsewhere ?? []}
              onIrAVersion={(id) => {
                setVersionElegida(id);
                setMostrandoDiff(false);
                setSelectedThread(null);
              }}
              versionMirada={versionElegida === null ? null : (elegida.data?.versionNo ?? null)}
              people={people.data ?? []}
              selectedId={selectedThread}
              onSelect={(id) => {
                setSelectedThread(id);
                setScrollToThread(id !== null);
              }}
              onNewGeneral={(body) => {
                createThread.mutate({ body });
              }}
              onReply={(threadId, body) => {
                reply.mutate({ threadId, body });
              }}
              onResolve={(threadId, resolved) => {
                resolveThread.mutate({ threadId, resolved });
              }}
              onDeleteThread={(threadId) => {
                deleteThread.mutate(threadId);
              }}
              onDeleteComment={(commentId) => {
                deleteComment.mutate(commentId);
              }}
            />
          )}
        </div>
      )}

      {tab === 'settings' && (
        <AppSettingsPage app={app.data} workspaceId={workspaceId} onDeleted={onBack} />
      )}
    </div>
  );
}

/**
 * Poner nombre a lo escrito (RF-505).
 *
 * El mensaje es obligatorio: una versión sin explicación es una fecha en una
 * lista. Y cabe en cien caracteres, que bastan para decir qué cambió sin que el
 * historial se convierta en el sitio donde se escribe la documentación.
 */
function CommitForm({
  mensaje,
  commiteando,
  onMensaje,
  onCancelar,
  onCommitear,
}: {
  mensaje: string;
  commiteando: boolean;
  onMensaje: (valor: string) => void;
  onCancelar: () => void;
  onCommitear: () => void;
}) {
  const restantes = 100 - mensaje.length;

  return (
    <Card className="flex flex-col gap-3 border-[var(--color-acento)]/40 p-4">
      <label htmlFor="commit-message" className="text-sm font-medium">
        What changed?
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="commit-message"
          value={mensaje}
          maxLength={100}
          autoFocus
          placeholder="Rewrote the problem statement"
          onChange={(e) => {
            onMensaje(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && mensaje.trim()) onCommitear();
          }}
          className="min-w-64 flex-1"
        />
        <Button onClick={onCommitear} disabled={commiteando || !mensaje.trim()}>
          {commiteando ? 'Creating…' : 'Create version'}
        </Button>
        <Button variant="secondary" onClick={onCancelar}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-[var(--color-texto-suave)]">
        {restantes} characters left. Comments on the current version stay with it: the new one
        starts its own conversation.
      </p>
    </Card>
  );
}

/**
 * Aviso antes de descartar (RF-515).
 *
 * Es la única acción del producto que pierde trabajo de verdad: lo descartado no
 * llegó a ser versión, así que no queda en ningún sitio del que rescatarlo. Por
 * eso el aviso dice de quién es lo que se va a perder, que a veces no es de
 * quien está pulsando.
 */
function DescarteNotice({
  autores,
  descartando,
  onCancelar,
  onDescartar,
}: {
  autores: string[];
  descartando: boolean;
  onCancelar: () => void;
  onDescartar: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3 border-[var(--color-fallo)]/40 p-4">
      <p className="text-sm font-medium" style={{ color: 'var(--color-fallo)' }}>
        Discard everything saved since the last version?
      </p>
      <p className="text-sm text-[var(--color-texto-suave)]">
        The document goes back to the current version.{' '}
        {autores.length > 0 && (
          <>These changes were saved by {autores.map((h) => `@${h}`).join(', ')}. </>
        )}
        They were never committed, so there is nowhere to get them back from.
      </p>
      <div className="flex gap-2">
        <Button variant="danger" disabled={descartando} onClick={onDescartar}>
          {descartando ? 'Discarding…' : 'Yes, discard them'}
        </Button>
        <Button variant="secondary" onClick={onCancelar}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/**
 * Aviso de conflicto (RF-511).
 *
 * No basta con decir que falló: se enseña quién guardó y qué hay ahora, porque
 * lo que la persona necesita decidir es si su texto sigue teniendo sentido
 * encima del de otro.
 */
function ConflictNotice({
  conflict,
  onDismiss,
}: {
  conflict: SaveConflict;
  onDismiss: () => void;
}) {
  return (
    <Card className="border-[var(--color-fallo)]/40 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium" style={{ color: 'var(--color-fallo)' }}>
              @{conflict.lastAuthorHandle} saved version {conflict.currentVersionNo} while you were
              writing
            </p>
            <p className="text-sm text-[var(--color-texto-suave)]">
              Nothing was overwritten. Below is what changed — copy over whatever still applies.
            </p>
          </div>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
        <details>
          <summary className="cursor-pointer text-sm">See the saved version</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-fondo)] p-3 text-xs">
            {conflict.currentContent}
          </pre>
        </details>
      </div>
    </Card>
  );
}

function Descarga() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2.5v7M5 7l3 3 3-3M3 12.5h10" />
    </svg>
  );
}

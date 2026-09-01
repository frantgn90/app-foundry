import { ASSIST_LABELS, type AssistAction, type AssistMeta } from '../lib/assist.js';
import { DiffView } from './diff-view.js';
import { Button } from './ui/button.js';
import { Card } from './ui/card.js';

export interface AssistState {
  action: AssistAction;
  scope: 'SELECTION' | 'DOCUMENT';
  /**
   * El documento tal como estaba **al pedirlo**, y dónde encaja la propuesta.
   *
   * Se guarda entero y no solo el fragmento porque aceptar es reconstruir el
   * documento con el trozo sustituido, y hacerlo contra el texto de ahora
   * aplicaría el cambio sobre otra cosa si alguien guardó mientras tanto. Con la
   * revisión de entonces, el servidor rechaza justamente ese caso (RF-1408).
   */
  base: string;
  start: number;
  end: number;
  revision: number;
  /** El texto original sobre el que se pidió, para comparar contra él. */
  original: string;
  /** Lo que va llegando. */
  propuesta: string;
  meta: AssistMeta | null;
  generando: boolean;
  error: string | null;
}

/**
 * La propuesta del asistente, como cambio y no como resultado (RF-1403).
 *
 * Se pinta con el mismo componente que compara versiones. No es reutilización
 * por ahorrar: es que **es la misma pregunta** —qué cambiaría si acepto—, y
 * responderla con dos pantallas distintas obligaría a aprender dos.
 *
 * Nada se aplica antes de tiempo. Lo que llega se puede leer mientras llega y
 * descartar a media respuesta, que es para lo que sirve el streaming (RF-1407).
 */
export function AssistProposal({
  estado,
  aplicando,
  onAceptar,
  onDescartar,
}: {
  estado: AssistState;
  aplicando: boolean;
  onAceptar: () => void;
  onDescartar: () => void;
}) {
  const vacia = estado.propuesta.trim() === '';

  return (
    <Card
      /*
        Una región con nombre, no un trozo de página suelto: quien navega con
        lector de pantalla llega a la propuesta y sabe dónde está, en lugar de
        encontrarse un diff que aparece de la nada bajo el documento.
      */
      role="group"
      aria-label="AI proposal"
      className="flex flex-col gap-3 border-[var(--color-acento)]/40 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{ASSIST_LABELS[estado.action].label}</span>
        <span className="text-xs text-[var(--color-texto-suave)]">
          {estado.scope === 'DOCUMENT' ? 'whole document' : 'selected text'}
          {estado.meta && ` · ${estado.meta.model}`}
        </span>

        {estado.generando && <span className="text-xs text-[var(--color-acento)]">Writing…</span>}
      </div>

      {/*
        Que el documento no cupiera se dice, no se calla (RF-1409). Callarlo
        haría que una propuesta escrita sin ver el resto pareciera escrita
        habiéndolo visto, que es exactamente la confusión que hay que evitar.
      */}
      {estado.meta?.contextTrimmed && (
        <p className="text-xs text-[var(--color-texto-suave)]">
          The document was too long to send whole, so only the text around your selection went with
          it.
        </p>
      )}

      {estado.error ? (
        <p className="text-sm" style={{ color: 'var(--color-fallo)' }}>
          {estado.error}
        </p>
      ) : vacia ? (
        <p className="text-sm text-[var(--color-texto-suave)]">Waiting for the first words…</p>
      ) : (
        <DiffView from={estado.original} to={estado.propuesta} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/*
          Aceptar espera al final. A media generación la propuesta está cortada,
          y aplicarla dejaría el documento con media frase: descartar sí se
          puede en cualquier momento, que es la asimetría correcta.
        */}
        <Button onClick={onAceptar} disabled={estado.generando || vacia || aplicando}>
          {aplicando ? 'Applying…' : 'Accept'}
        </Button>
        <Button variant="secondary" onClick={onDescartar}>
          {estado.generando ? 'Stop and discard' : 'Discard'}
        </Button>

        {!estado.generando && !estado.error && estado.meta && (
          <span className="ml-auto text-xs text-[var(--color-texto-suave)]">
            Accepting writes to the working copy. It does not create a version.
          </span>
        )}
      </div>
    </Card>
  );
}

/**
 * Lo que va a costar, antes de pedirlo (RF-1412).
 *
 * Solo para el documento entero: es la operación más cara del producto y la
 * única en la que el tamaño no se ve de un vistazo. Sobre una selección, lo que
 * se va a mandar está delante y subrayado.
 *
 * Se dice «como mucho», porque eso es lo que es: entrada contada más salida al
 * máximo. Una media que luego se pase sería peor que no decir nada.
 */
export function AssistEstimatePrompt({
  action,
  tokens,
  pidiendo,
  onConfirmar,
  onCancelar,
}: {
  action: AssistAction;
  tokens: number | null;
  pidiendo: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <Card
      role="group"
      aria-label="AI estimate"
      className="flex flex-wrap items-center gap-3 border-[var(--color-acento)]/40 p-4"
    >
      <span className="text-sm">
        {ASSIST_LABELS[action].label} — the whole document.
        {tokens === null ? (
          <span className="text-[var(--color-texto-suave)]"> Working out what it costs…</span>
        ) : (
          <span className="text-[var(--color-texto-suave)]">
            {' '}
            This will use at most {tokens.toLocaleString()} tokens of this workspace&apos;s quota.
          </span>
        )}
      </span>

      <span className="ml-auto flex gap-2">
        <Button onClick={onConfirmar} disabled={tokens === null || pidiendo}>
          {pidiendo ? 'Asking…' : 'Go ahead'}
        </Button>
        <Button variant="secondary" onClick={onCancelar}>
          Cancel
        </Button>
      </span>
    </Card>
  );
}

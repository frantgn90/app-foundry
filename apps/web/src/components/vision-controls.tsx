import type { Version } from '../lib/api.js';
import { cn } from '../lib/utils.js';

/**
 * Botón de edición del documento.
 *
 * Un solo botón que se queda pulsado, no dos opciones enfrentadas: editar o no
 * editar es una cosa con dos estados, y enseñar los dos lados de un interruptor
 * binario obliga a leer ambos para saber en cuál se está.
 *
 * `aria-pressed` es lo que lo distingue de un botón normal para quien navega sin
 * ver: anuncia que es un conmutador y en qué posición está.
 */
export function EditToggle({
  editando,
  puedeEditar,
  razonBloqueo = 'You can read this app but not edit it',
  onEditando,
}: {
  editando: boolean;
  puedeEditar: boolean;
  /*
   * Por qué está apagado. No siempre es la falta de permiso —mirando una versión
   * anterior tampoco se escribe—, y «puedes leer pero no editar» ahí sería
   * mentira: quien lo lee tiene permiso de sobra y se quedaría buscándolo.
   */
  razonBloqueo?: string;
  onEditando: (valor: boolean) => void;
}) {
  const titulo = puedeEditar ? (editando ? 'Stop editing' : 'Edit') : razonBloqueo;

  return (
    <button
      aria-pressed={editando}
      aria-label={titulo}
      title={titulo}
      disabled={!puedeEditar}
      onClick={() => {
        onEditando(!editando);
      }}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-lg border transition',
        'disabled:cursor-not-allowed disabled:opacity-35',
        editando
          ? 'border-[var(--color-acento)] bg-[color-mix(in_oklab,var(--color-acento)_14%,var(--color-superficie))] text-[var(--color-acento)]'
          : 'border-[var(--color-borde)] bg-[var(--color-superficie)] text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M11.2 2.3 13.7 4.8 5.6 12.9 2.5 13.5l.6-3.1Z" />
        <path d="M10 3.5 12.5 6" />
      </svg>
    </button>
  );
}

/**
 * Historial del documento como desplegable (RF-507, RF-508, RF-510).
 *
 * El historial no es un sitio aparte al que se va: es una propiedad de lo que ya
 * se está mirando. Puesto encima del documento, elegir una versión cambia el
 * texto de debajo, y lo que antes obligaba a cambiar de pestaña y volver ahora
 * se hace sin perder de vista el documento.
 *
 * Comparar y restaurar solo aparecen con una versión pasada elegida: sobre la
 * actual no significan nada —compararla consigo misma, restaurar lo que ya
 * está—, y enseñarlos apagados sería ocupar sitio para decir que no.
 */
export function VersionPicker({
  versions,
  currentVersionId,
  elegida,
  mostrandoDiff,
  puedeRestaurar,
  restaurando,
  onElegir,
  onDiff,
  onRestaurar,
}: {
  versions: Version[];
  currentVersionId: string | null;
  /** Versión pasada que se está mirando; `null` es la actual. */
  elegida: string | null;
  mostrandoDiff: boolean;
  puedeRestaurar: boolean;
  restaurando: boolean;
  onElegir: (versionId: string | null) => void;
  onDiff: () => void;
  onRestaurar: () => void;
}) {
  const seleccionada = elegida ?? currentVersionId ?? '';
  const version = versions.find((v) => v.id === seleccionada);

  return (
    <>
      <select
        aria-label="Version"
        value={seleccionada}
        onChange={(e) => {
          onElegir(e.target.value === currentVersionId ? null : e.target.value);
        }}
        className={cn(
          // Ancho fijo: si no, la caja cambiaría de tamaño con cada versión
          // elegida, porque un `select` se mide por la opción que muestra.
          'h-8 w-40 shrink-0 rounded-lg border px-2 text-xs',
          'border-[var(--color-borde)] bg-[var(--color-superficie)]',
        )}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            v{v.versionNo}
            {v.id === currentVersionId
              ? ' · current'
              : ` · ${new Date(v.createdAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                })}`}
          </option>
        ))}
      </select>

      {elegida !== null && (
        <>
          <button
            aria-pressed={mostrandoDiff}
            onClick={onDiff}
            className={cn(
              'h-8 shrink-0 rounded-lg border px-2.5 text-xs transition',
              mostrandoDiff
                ? 'border-[var(--color-acento)] bg-[color-mix(in_oklab,var(--color-acento)_14%,var(--color-superficie))] text-[var(--color-acento)]'
                : 'border-[var(--color-borde)] bg-[var(--color-superficie)] text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
            )}
          >
            {mostrandoDiff ? 'Hide changes' : 'Compare with current'}
          </button>

          {puedeRestaurar && (
            <button
              disabled={restaurando}
              onClick={onRestaurar}
              className={cn(
                'h-8 shrink-0 rounded-lg border px-2.5 text-xs transition',
                'border-[var(--color-borde)] bg-[var(--color-superficie)]',
                'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {restaurando ? 'Restoring…' : 'Restore'}
            </button>
          )}
        </>
      )}

      {/*
        Quién la guardó y cuándo, que es lo que traía la lista del historial. Va
        detrás de los botones y no dentro del desplegable: en una opción, el
        navegador la recortaría por donde le pareciera.
      */}
      {version && (
        <span
          /* Con la conversación abierta la línea se queda corta y el texto se
             recorta; el título lo devuelve entero sin robar sitio. */
          title={`@${version.authorHandle} · ${new Date(version.createdAt).toLocaleString()}${
            version.message ? ` · ${version.message}` : ''
          }`}
          className="min-w-0 truncate text-xs text-[var(--color-texto-suave)]"
        >
          {/* Sin el año ni los segundos: la fecha entera se comía la línea y
              dejaba fuera el mensaje, que es lo que dice qué se cambió. */}
          @{version.authorHandle} ·{' '}
          {new Date(version.createdAt).toLocaleString(undefined, {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {version.message ? ` · ${version.message}` : ''}
        </span>
      )}
    </>
  );
}

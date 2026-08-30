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
  onEditando,
}: {
  editando: boolean;
  puedeEditar: boolean;
  onEditando: (valor: boolean) => void;
}) {
  const titulo = puedeEditar
    ? editando
      ? 'Stop editing'
      : 'Edit'
    : 'You can read this app but not edit it';

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

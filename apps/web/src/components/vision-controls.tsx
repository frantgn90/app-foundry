import { cn } from '../lib/utils.js';

/**
 * El interruptor de la vista del documento.
 *
 * Uno solo, no dos: leer es ver el texto compuesto y escribir es tocar el
 * markdown, así que la vista se deduce de lo que se está haciendo. Dos
 * interruptores permitían combinaciones que no significaban nada y obligaban a
 * pensar en dos cosas para decidir una.
 *
 * Va sin etiquetas porque son dos estados de lo mismo y las palabras pesarían
 * más que la barra; cada botón lleva su `title` y su nombre accesible, que es lo
 * que necesita quien no reconozca el icono o no vea ninguno.
 */
export function VisionControls({
  editando,
  puedeEditar,
  onEditando,
}: {
  editando: boolean;
  puedeEditar: boolean;
  onEditando: (valor: boolean) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Document mode"
      className="flex items-center gap-0.5 rounded-lg border border-[var(--color-borde)] bg-[var(--color-superficie)] p-0.5"
    >
      <Opcion
        activo={!editando}
        titulo="Preview"
        onClick={() => {
          onEditando(false);
        }}
      >
        <Ojo />
      </Opcion>
      <Opcion
        activo={editando}
        titulo={puedeEditar ? 'Edit' : 'You can read this app but not edit it'}
        deshabilitado={!puedeEditar}
        onClick={() => {
          onEditando(true);
        }}
      >
        <Lapiz />
      </Opcion>
    </div>
  );
}

function Opcion({
  activo,
  titulo,
  deshabilitado = false,
  onClick,
  children,
}: {
  activo: boolean;
  titulo: string;
  deshabilitado?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="radio"
      aria-checked={activo}
      aria-label={titulo}
      title={titulo}
      disabled={deshabilitado}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded transition',
        'disabled:cursor-not-allowed disabled:opacity-35',
        activo
          ? 'bg-[var(--color-borde)] text-[var(--color-texto)]'
          : 'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
      )}
    >
      {children}
    </button>
  );
}

/* En trazo y con `currentColor`, para que sigan al tema y al estado del botón
   sin tener que dibujar variantes. */
const trazo = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'size-4',
  'aria-hidden': true,
} as const;

function Ojo() {
  return (
    <svg {...trazo}>
      <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}

function Lapiz() {
  return (
    <svg {...trazo}>
      <path d="M11.2 2.3 13.7 4.8 5.6 12.9 2.5 13.5l.6-3.1Z" />
      <path d="M10 3.5 12.5 6" />
    </svg>
  );
}

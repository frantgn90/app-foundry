import { cn } from '../lib/utils.js';

/**
 * Los dos interruptores de la vista del documento.
 *
 * Van sin texto porque son dos pares y las cuatro etiquetas juntas pesarían más
 * que la barra entera. Cada botón lleva su `title` y su nombre accesible, que es
 * lo que necesita quien no reconozca el icono o no vea ninguno.
 */
export function VisionControls({
  editando,
  vista,
  puedeEditar,
  onEditando,
  onVista,
}: {
  editando: boolean;
  vista: 'plain' | 'rendered';
  puedeEditar: boolean;
  onEditando: (valor: boolean) => void;
  onVista: (valor: 'plain' | 'rendered') => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Grupo etiqueta="Editing">
        <Opcion
          activo={!editando}
          titulo="Reading"
          onClick={() => {
            onEditando(false);
          }}
        >
          <Ojo />
        </Opcion>
        <Opcion
          activo={editando}
          titulo={puedeEditar ? 'Editing' : 'You can read this app but not edit it'}
          deshabilitado={!puedeEditar}
          onClick={() => {
            onEditando(true);
          }}
        >
          <Lapiz />
        </Opcion>
      </Grupo>

      <Grupo etiqueta="View">
        <Opcion
          activo={vista === 'rendered'}
          titulo="Rendered"
          onClick={() => {
            onVista('rendered');
          }}
        >
          <Parrafos />
        </Opcion>
        <Opcion
          activo={vista === 'plain'}
          titulo="Plain text"
          onClick={() => {
            onVista('plain');
          }}
        >
          <Corchetes />
        </Opcion>
      </Grupo>
    </div>
  );
}

function Grupo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div
      role="radiogroup"
      aria-label={etiqueta}
      className="flex items-center gap-0.5 rounded-lg border border-[var(--color-borde)] bg-[var(--color-superficie)] p-0.5"
    >
      {children}
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

/* Los iconos van en trazo y con `currentColor`, para que sigan al tema y al
   estado del botón sin tener que dibujar variantes. */
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

/** Párrafos: el documento ya compuesto. */
function Parrafos() {
  return (
    <svg {...trazo}>
      <path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h8M2.5 12.5h5" />
    </svg>
  );
}

/** Corchetes angulares: el texto tal cual se escribió. */
function Corchetes() {
  return (
    <svg {...trazo}>
      <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" />
    </svg>
  );
}

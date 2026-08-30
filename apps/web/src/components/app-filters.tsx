import type { AppFilters } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { statusLabel, STATUSES } from './app-status.js';

/**
 * Filtros del listado (RF-602, RF-603).
 *
 * Se enseñan siempre en vez de esconderlos tras un botón: lo que está a la vista
 * dice también qué se puede hacer, y un filtro escondido no se usa nunca. Lo
 * activo se marca lo bastante como para que nadie se pregunte por qué faltan
 * apps, que es el problema clásico de una lista filtrada.
 */
export function AppFiltersBar({
  filtros,
  etiquetas,
  total,
  onChange,
}: {
  filtros: AppFilters;
  etiquetas: string[];
  /** Cuántas hay con los filtros puestos. */
  total: number;
  onChange: (siguiente: AppFilters) => void;
}) {
  const activos =
    (filtros.status?.length ?? 0) +
    (filtros.tag?.length ?? 0) +
    (filtros.archived && filtros.archived !== 'hide' ? 1 : 0);

  function alternar(clave: 'status' | 'tag', valor: string) {
    const actuales = filtros[clave] ?? [];
    const siguiente = actuales.includes(valor)
      ? actuales.filter((v) => v !== valor)
      : [...actuales, valor];
    // Volver a la primera página: la cuarta página de otro filtro no existe.
    onChange({ ...filtros, [clave]: siguiente, page: 1 });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      {/*
        El recuento va con los filtros y no en una cabecera aparte: es la
        respuesta a lo que se acaba de marcar, y al lado de los chips se ve subir
        y bajar mientras se acota. Cuando hay algo puesto, el número deja de ser
        «cuántas hay» y pasa a ser «cuántas quedan», así que lo dice.
      */}
      <span className="shrink-0 text-[var(--color-texto-suave)]">
        {total} {total === 1 ? 'idea' : 'ideas'}
        {activos > 0 && ' match'}
      </span>
      <span className="text-[var(--color-borde)]" aria-hidden>
        |
      </span>

      <span className="flex flex-wrap items-center gap-1">
        {STATUSES.map((estado) => (
          <Chip
            key={estado}
            activo={filtros.status?.includes(estado) ?? false}
            onClick={() => {
              alternar('status', estado);
            }}
          >
            {statusLabel(estado)}
          </Chip>
        ))}
      </span>

      {etiquetas.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          <span className="text-[var(--color-texto-suave)]">·</span>
          {etiquetas.map((tag) => (
            <Chip
              key={tag}
              activo={filtros.tag?.includes(tag) ?? false}
              onClick={() => {
                alternar('tag', tag);
              }}
            >
              #{tag}
            </Chip>
          ))}
        </span>
      )}

      <span className="ml-auto flex items-center gap-3">
        <Chip
          activo={filtros.archived === 'all' || filtros.archived === 'only'}
          onClick={() => {
            onChange({
              ...filtros,
              archived: filtros.archived === 'hide' || !filtros.archived ? 'all' : 'hide',
              page: 1,
            });
          }}
        >
          Archived
        </Chip>

        <label className="flex items-center gap-1 text-[var(--color-texto-suave)]">
          Sort
          <select
            value={filtros.sort ?? 'updated'}
            onChange={(e) => {
              onChange({ ...filtros, sort: e.target.value as 'updated' | 'name', page: 1 });
            }}
            className="rounded border border-[var(--color-borde)] bg-[var(--color-superficie)] px-1 py-0.5 text-xs"
          >
            <option value="updated">Recent</option>
            <option value="name">Name</option>
          </select>
        </label>

        {activos > 0 && (
          <button
            onClick={() => {
              onChange({ sort: filtros.sort ?? 'updated', page: 1 });
            }}
            className="text-[var(--color-acento)] hover:underline"
          >
            Clear
          </button>
        )}
      </span>
    </div>
  );
}

function Chip({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        'rounded-full border px-2 py-0.5 transition',
        /*
         * Fondo opaco y no transparente: estos controles se ven sobre el fondo
         * del workspace, que puede ser un degradado, y un relleno translúcido se
         * mezclaría con él dejando cada chip de un color distinto según dónde
         * caiga. El activo lleva el tinte del acento ya mezclado contra la
         * superficie, por lo mismo.
         */
        activo
          ? 'border-[var(--color-acento)] bg-[color-mix(in_oklab,var(--color-acento)_14%,var(--color-superficie))] text-[var(--color-acento)]'
          : 'border-[var(--color-borde)] bg-[var(--color-superficie)] text-[var(--color-texto-suave)] hover:border-[var(--color-texto-suave)]',
      )}
    >
      {children}
    </button>
  );
}

import { cn } from '../lib/utils.js';

/**
 * Estado de una app, con color propio (RF-404).
 *
 * El color hace el trabajo: de un vistazo se distingue lo que está en marcha
 * de lo que sigue siendo una idea suelta, sin leer cada etiqueta. Sigue el
 * recorrido natural de una idea, de gris a verde, y el naranja del pausado
 * rompe esa progresión a propósito, porque es una interrupción.
 */
const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  IDEA: { label: 'Idea', className: 'bg-slate-500/15 text-slate-600 dark:text-slate-300' },
  DEFINING: { label: 'Defining', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  IN_DEVELOPMENT: {
    label: 'In development',
    className: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  },
  PUBLISHED: {
    label: 'Published',
    className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  PAUSED: { label: 'Paused', className: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
  ARCHIVED: { label: 'Archived', className: 'bg-slate-500/10 text-slate-500' },
};

/** Los estados en su orden natural, para ofrecerlos como filtro (RF-602). */
export const STATUSES = ['IDEA', 'DEFINING', 'IN_DEVELOPMENT', 'PUBLISHED', 'PAUSED'] as const;

export function statusLabel(status: string): string {
  return STATUS_STYLES[status]?.label ?? status;
}

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES['IDEA'];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
        style?.className,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {style?.label}
    </span>
  );
}

/**
 * Quién puede ver la app.
 *
 * Va como icono con su título y no como texto: es un dato de acceso, no una
 * categoría, y compite mal por la atención con el estado si ambos se dibujan
 * igual. Lo compartido no se marca —es lo normal dentro de un workspace—; lo
 * que merece señal es lo que solo ve una persona.
 */
export function VisibilityMark({ accessLevel }: { accessLevel: string }) {
  if (accessLevel === 'WORKSPACE_WRITE') return null;

  const isPrivate = accessLevel === 'PRIVATE';
  const title = isPrivate ? 'Only you can see this' : 'The workspace can read it, only you edit';

  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex items-center text-[var(--color-texto-suave)]"
    >
      {isPrivate ? (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
          <path d="M8 1a3 3 0 0 0-3 3v2H4.5A1.5 1.5 0 0 0 3 7.5v6A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 6H11V4a3 3 0 0 0-3-3Zm2 5H6V4a2 2 0 1 1 4 0v2Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
          <path d="M8 3.5c-3 0-5.4 2-6.4 4.2a.8.8 0 0 0 0 .6C2.6 10.5 5 12.5 8 12.5s5.4-2 6.4-4.2a.8.8 0 0 0 0-.6C13.4 5.5 11 3.5 8 3.5Zm0 7.2a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Zm0-1.3a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" />
        </svg>
      )}
    </span>
  );
}

/**
 * Etiquetas.
 *
 * Se dibujan con almohadilla y en tono apagado para que no compitan con el
 * estado: son clasificación de quien escribe, no información del sistema.
 */
/**
 * Etiquetas de una app.
 *
 * Con forma de insignia y no como texto suelto: son clasificación, y a simple
 * vista tienen que distinguirse de la descripción que llevan al lado. El fondo
 * es opaco porque estas se ven sobre el fondo del workspace, que puede ser un
 * degradado.
 */
export function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs',
            'border border-[var(--color-borde)] bg-[var(--color-superficie)]',
            'text-[var(--color-texto-suave)]',
          )}
        >
          <span className="opacity-60">#</span>
          {tag}
        </span>
      ))}
    </div>
  );
}

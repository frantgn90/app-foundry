import { cn } from '../../lib/utils.js';

export function Avatar({
  src,
  name,
  className,
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();

  return src ? (
    <img
      src={src}
      alt=""
      className={cn('size-7 shrink-0 rounded-full object-cover', className)}
      // Decorativo: el name siempre está en el texto contiguo, así que
      // repetirlo aquí solo haría que un lector de pantalla lo dijera dos veces.
      aria-hidden
    />
  ) : (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full',
        'bg-[var(--color-borde)] text-[10px] font-semibold',
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

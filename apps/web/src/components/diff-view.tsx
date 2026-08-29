import { diffWords } from 'diff';
import { useMemo } from 'react';

/**
 * Diferencias entre dos versiones (RF-508).
 *
 * El cálculo se hace aquí y no en el servidor: es una operación puramente
 * visual y el navegador la resuelve al instante con los dos contenidos que ya
 * ha recibido.
 *
 * Se compara por palabras y no por líneas porque una visión es prosa: en un
 * párrafo reescrito a medias, el diff por líneas marcaría el párrafo entero y
 * no diría nada útil.
 */
export function DiffView({ from, to }: { from: string; to: string }) {
  const parts = useMemo(() => diffWords(from, to), [from, to]);

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[var(--color-borde)] bg-[var(--color-fondo)] p-4 text-sm leading-relaxed">
      {parts.map((part, index) => (
        <span
          key={index}
          className={
            part.added
              ? 'bg-[var(--color-ok)]/20 text-[var(--color-texto)]'
              : part.removed
                ? 'bg-[var(--color-fallo)]/20 text-[var(--color-texto)] line-through'
                : 'text-[var(--color-texto-suave)]'
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}

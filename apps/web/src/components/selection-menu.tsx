import { Button } from './ui/button.js';

/**
 * Menú que aparece junto a una selección de texto.
 *
 * Se muestra al soltar el ratón, pero **no** abre el formulario: comentar es
 * una decisión, y seleccionar texto no lo es —se selecciona para leer, para
 * copiar o sin querer—. Un formulario que se abre solo interrumpe la lectura
 * cada vez.
 */
export function SelectionMenu({
  position,
  onComment,
}: {
  position: { top: number; left: number };
  onComment: () => void;
}) {
  return (
    <div
      className="fixed z-20 -translate-x-1/2 -translate-y-full pb-2"
      style={{ top: position.top, left: position.left }}
      // Evita que al pulsar se pierda la selección antes de leerla.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <Button className="shadow-lg" onClick={onComment}>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
          <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H6.7l-3 2.6A.5.5 0 0 1 3 13.2V11h-.5A1.5 1.5 0 0 1 1 9.5v-6Z" />
        </svg>
        Add inline comment
      </Button>
    </div>
  );
}

import { useLayoutEffect, useRef, useState } from 'react';

import { Button } from './ui/button.js';

/** Margen entre el texto marcado y el menú, y respiro contra el borde. */
const SEPARACION = 8;
const MARGEN = 8;

/**
 * Menú que aparece junto a una selección de texto.
 *
 * Se muestra al seleccionar, pero **no** abre el formulario: comentar es una
 * decisión, y seleccionar texto no lo es —se selecciona para leer, para copiar o
 * sin querer—. Un formulario que se abre solo interrumpe la lectura cada vez.
 *
 * Se coloca a partir de la **geometría de la selección** y no del puntero
 * (RF-1414): debajo de su última línea y alineado a su derecha. Con el ratón
 * como referencia, arrastrar deprisa lo dejaba lejos del texto y arrastrar hacia
 * la izquierda lo dejaba al principio, porque es donde termina el gesto. Y con
 * teclado no hay puntero que consultar.
 */
export function SelectionMenu({ rect, onComment }: { rect: DOMRect; onComment: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [posicion, setPosicion] = useState<{ top: number; left: number } | null>(null);

  /*
   * Hace falta medir el menú para alinearlo por su derecha y para saber si cabe
   * debajo, así que se coloca después de pintarlo. `useLayoutEffect` y no
   * `useEffect` porque si no se vería un fotograma en la esquina antes de saltar
   * a su sitio.
   */
  useLayoutEffect(() => {
    const caja = ref.current?.getBoundingClientRect();
    if (!caja) return;

    const cabeDebajo = rect.bottom + SEPARACION + caja.height < window.innerHeight;
    const top = cabeDebajo ? rect.bottom + SEPARACION : rect.top - caja.height - SEPARACION;

    const derecha = rect.right - caja.width;
    const left = Math.min(Math.max(MARGEN, derecha), window.innerWidth - caja.width - MARGEN);

    setPosicion({ top: Math.max(MARGEN, top), left });
  }, [rect]);

  return (
    <div
      ref={ref}
      className="fixed z-20"
      style={{
        top: posicion?.top ?? rect.bottom + SEPARACION,
        left: posicion?.left ?? rect.right,
        /* Invisible hasta estar colocado: aparecer y saltar se ve peor que tardar un fotograma. */
        visibility: posicion ? 'visible' : 'hidden',
      }}
      // Evita que al pulsar se pierda la selección antes de leerla.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      {/* Pequeño y sobrio: aparece cada vez que alguien selecciona algo, así
          que cuanto menos pese en la pantalla, mejor. */}
      <Button className="gap-1.5 px-2 py-1 text-xs shadow-md" onClick={onComment}>
        <svg viewBox="0 0 16 16" className="size-3" fill="currentColor" aria-hidden>
          <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H6.7l-3 2.6A.5.5 0 0 1 3 13.2V11h-.5A1.5 1.5 0 0 1 1 9.5v-6Z" />
        </svg>
        Comment
      </Button>
    </div>
  );
}

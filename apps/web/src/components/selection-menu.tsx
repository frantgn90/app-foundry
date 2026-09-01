import { useLayoutEffect, useRef, useState } from 'react';

import { ASSIST_ACTIONS, ASSIST_LABELS, type AssistAction } from '../lib/assist.js';
import { Button } from './ui/button.js';
import { cn } from '../lib/utils.js';

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
 *
 * Comentar y reescribir viven **en el mismo menú** (RF-1401): son dos cosas que
 * se hacen sobre lo mismo y no merecen dos gestos distintos. Las cinco acciones
 * no se enseñan de entrada porque serían seis botones cada vez que alguien marca
 * una palabra: se abren dentro de esta misma caja al pedirlas, que es un paso
 * más pero solo para quien lo quiere.
 */
export function SelectionMenu({
  rect,
  puedeAsistir,
  onComment,
  onAssist,
}: {
  rect: DOMRect;
  /** Si la IA está disponible aquí y ahora (RF-1010). */
  puedeAsistir: boolean;
  onComment: () => void;
  onAssist: (action: AssistAction) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [posicion, setPosicion] = useState<{ top: number; left: number } | null>(null);
  const [eligiendo, setEligiendo] = useState(false);

  /*
   * Hace falta medir el menú para alinearlo por su derecha y para saber si cabe
   * debajo, así que se coloca después de pintarlo. `useLayoutEffect` y no
   * `useEffect` porque si no se vería un fotograma en la esquina antes de saltar
   * a su sitio.
   *
   * Se vuelve a medir al abrir las acciones: la caja crece de golpe y, pegada al
   * borde inferior, se saldría de la ventana sin que nadie la recolocara.
   */
  useLayoutEffect(() => {
    const caja = ref.current?.getBoundingClientRect();
    if (!caja) return;

    const cabeDebajo = rect.bottom + SEPARACION + caja.height < window.innerHeight;
    const top = cabeDebajo ? rect.bottom + SEPARACION : rect.top - caja.height - SEPARACION;

    const derecha = rect.right - caja.width;
    const left = Math.min(Math.max(MARGEN, derecha), window.innerWidth - caja.width - MARGEN);

    setPosicion({ top: Math.max(MARGEN, top), left });
  }, [rect, eligiendo]);

  return (
    <div
      ref={ref}
      /*
        `select-none` no es cosmético: el menú aparece justo detrás del
        documento en el árbol, así que una selección que se pasa de largo —el
        triple clic sobre el último párrafo lo hace— se lo lleva dentro y el
        propio «Comment» pasaba a formar parte del texto marcado.
      */
      className="fixed z-20 select-none"
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
      {eligiendo ? (
        <div className="flex w-56 flex-col rounded-lg border border-[var(--color-borde)] bg-[var(--color-superficie)] p-1 shadow-lg">
          {ASSIST_ACTIONS.map((action) => (
            <button
              key={action}
              onClick={() => {
                onAssist(action);
              }}
              className={cn(
                'rounded-md px-2 py-1.5 text-left text-xs transition',
                'hover:bg-[color-mix(in_oklab,var(--color-acento)_12%,var(--color-superficie))]',
              )}
            >
              <span className="block text-[var(--color-texto)]">{ASSIST_LABELS[action].label}</span>
              {/* Qué promete cada una: sin esto, «concretar» y «mejorar» se
                  distinguen probándolas, que cuesta cuota y una espera. */}
              <span className="block text-[10px] text-[var(--color-texto-suave)]">
                {ASSIST_LABELS[action].hint}
              </span>
            </button>
          ))}
        </div>
      ) : (
        /* Pequeño y sobrio: aparece cada vez que alguien selecciona algo, así
           que cuanto menos pese en la pantalla, mejor. */
        <div className="flex items-center gap-1 rounded-lg bg-[var(--color-superficie)] shadow-md">
          <Button className="gap-1.5 px-2 py-1 text-xs" onClick={onComment}>
            <svg viewBox="0 0 16 16" className="size-3" fill="currentColor" aria-hidden>
              <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H6.7l-3 2.6A.5.5 0 0 1 3 13.2V11h-.5A1.5 1.5 0 0 1 1 9.5v-6Z" />
            </svg>
            Comment
          </Button>

          {/* Sin IA disponible no hay botón, ni apagado: un control que no se
              puede encender desde aquí solo invita a preguntarse por qué. */}
          {puedeAsistir && (
            <Button
              variant="secondary"
              className="gap-1.5 px-2 py-1 text-xs"
              onClick={() => {
                setEligiendo(true);
              }}
            >
              <Chispa />
              Rewrite
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Chispa() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" fill="currentColor" aria-hidden>
      <path d="M8 1.5 9.4 5.4 13.3 6.8 9.4 8.2 8 12.1 6.6 8.2 2.7 6.8 6.6 5.4Z" />
      <path d="M12.6 10.2 13.2 11.8 14.8 12.4 13.2 13 12.6 14.6 12 13 10.4 12.4 12 11.8Z" />
    </svg>
  );
}

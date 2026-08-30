import { type Tema, useTema } from '../lib/theme.js';
import { cn } from '../lib/utils.js';

const OPCIONES: { valor: Tema; etiqueta: string; icono: string }[] = [
  { valor: 'light', etiqueta: 'Light', icono: '☀' },
  { valor: 'system', etiqueta: 'System', icono: '◐' },
  { valor: 'dark', etiqueta: 'Dark', icono: '☾' },
];

/**
 * Elegir tema (RF-609).
 *
 * Tres opciones y no un interruptor de dos, porque «lo que diga el sistema» es
 * una respuesta distinta de claro y de oscuro: quien tiene el portátil
 * cambiando solo al anochecer no quiere quedarse fijado a ninguno de los dos.
 */
export function ThemeToggle() {
  const [tema, setTema] = useTema();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-lg border border-[var(--color-borde)] p-0.5"
    >
      {OPCIONES.map((opcion) => (
        <button
          key={opcion.valor}
          role="radio"
          aria-checked={tema === opcion.valor}
          title={opcion.etiqueta}
          onClick={() => {
            setTema(opcion.valor);
          }}
          className={cn(
            'grid size-6 place-items-center rounded text-xs transition',
            tema === opcion.valor
              ? 'bg-[var(--color-borde)] text-[var(--color-texto)]'
              : 'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
          )}
        >
          <span aria-hidden>{opcion.icono}</span>
          <span className="sr-only">{opcion.etiqueta}</span>
        </button>
      ))}
    </div>
  );
}

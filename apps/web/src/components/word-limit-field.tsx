import { Input } from './ui/input.js';

/** El tope que acepta la base y la API; aquí solo para no dejar escribir de más. */
export const MAX_REPLY_WORDS = 5000;

/**
 * Cuántas palabras como mucho se le piden a una respuesta (RF-1516).
 *
 * Se escribe en palabras y no en tokens porque quien configura un agente piensa
 * en «que no se enrolle», no en el presupuesto de generación. El número viaja al
 * prompt del sistema, así que es una petición al modelo y no un recorte del
 * texto: cortar por la mitad daría una respuesta mutilada, y esto da una corta.
 *
 * Cero es sin límite, y se dice: un campo numérico con un cero dentro invita a
 * pensar que el agente no puede contestar nada.
 */
export function WordLimitField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const numero = Number(value);
  const pasado = value.trim() !== '' && numero > MAX_REPLY_WORDS;

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">Reply length limit</span>
      <span className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={MAX_REPLY_WORDS}
          step={10}
          className="w-28"
          value={value}
          onChange={(evento) => {
            onChange(evento.target.value);
          }}
        />
        <span className="text-xs text-[var(--color-texto-suave)]">
          {value.trim() === '' || numero === 0
            ? 'words — 0 means no limit'
            : `words at most in each reply`}
        </span>
      </span>
      {pasado && (
        <span className="text-xs text-[var(--color-fallo)]">
          {MAX_REPLY_WORDS} words is the most you can ask for.
        </span>
      )}
    </label>
  );
}

/** Lo que se manda a la API: un entero entre 0 y el tope; vacío es sin límite. */
export function limiteAEnviar(value: string): number {
  const numero = Number.parseInt(value, 10);
  if (!Number.isFinite(numero) || numero <= 0) return 0;
  return Math.min(numero, MAX_REPLY_WORDS);
}

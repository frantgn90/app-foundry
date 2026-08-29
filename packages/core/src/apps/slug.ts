/**
 * Identificador legible de una app dentro de su workspace (RF-412).
 *
 * Se usa en la URL, así que tiene que ser estable y no sorprender: acentos
 * fuera, espacios a guiones y nada de caracteres que haya que escapar.
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    // Quita los diacríticos: «Visión» pasa a «vision», no a «visin».
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

  // Un nombre escrito solo con emojis o con otro alfabeto se quedaría sin nada
  // que convertir, y una URL vacía no es una URL.
  return base || 'app';
}

/**
 * Añade un sufijo hasta encontrar un hueco.
 *
 * La unicidad la garantiza la base de datos; esto solo evita el ida y vuelta
 * de intentar, chocar y reintentar en el caso más frecuente.
 */
export function uniqueSlug(name: string, taken: readonly string[]): string {
  const base = slugify(name);
  if (!taken.includes(base)) return base;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${String(n)}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${String(Date.now())}`;
}

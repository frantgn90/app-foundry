/**
 * Menciones dentro de un comentario (RF-814).
 *
 * Un handle de GitHub admite letras, números y guiones, no empieza ni termina
 * en guion y no supera 39 caracteres. Se sigue esa forma porque el handle de
 * App Foundry **es** el de GitHub (D-17).
 */
const MENTION = /(^|[^\w@])@([A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38})/g;

/**
 * Extrae los handles mencionados, sin repetir y en minúsculas.
 *
 * Solo se reconoce una mención cuando la arroba abre palabra: así una dirección
 * de correo escrita en el comentario no se convierte en una mención a medias
 * del dominio.
 *
 * Que un handle aparezca aquí no significa que exista ni que pueda mencionarse:
 * eso lo decide después quien comprueba la pertenencia al workspace (RF-815).
 */
export function extractMentions(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(MENTION)) {
    const handle = match[2];
    if (handle) found.add(handle.toLowerCase());
  }
  return [...found];
}

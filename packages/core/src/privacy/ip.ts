/**
 * Recorta una dirección IP para poder reconocer una sesión sin rastrear a nadie.
 *
 * Se guarda el prefijo de red —/24 en IPv4, /48 en IPv6— porque basta para que
 * alguien reconozca «esta sesión es la de mi oficina» y no basta para seguirle
 * la pista (RF-706, RNF-112).
 *
 * Devuelve `null` ante cualquier entrada que no sepa tratar. Guardar la IP es
 * una comodidad: que falle no puede impedir un inicio de sesión.
 */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;

  // Las direcciones IPv4 mapeadas en IPv6 llegan así desde Node.
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const limpia = mapeada?.[1] ?? ip;

  if (limpia.includes('.')) return truncateIpv4(limpia);
  if (limpia.includes(':')) return truncateIpv6(limpia);
  return null;
}

function truncateIpv4(ip: string): string | null {
  const octetos = ip.split('.');
  if (octetos.length !== 4) return null;
  if (!octetos.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)) return null;
  return `${octetos.slice(0, 3).join('.')}.0`;
}

function truncateIpv6(ip: string): string | null {
  const grupos = expandIpv6(ip);
  if (grupos === null) return null;
  // Prefijo /48: los tres primeros grupos, y el resto a cero.
  return `${grupos.slice(0, 3).join(':')}::`;
}

/**
 * Expande la forma comprimida de IPv6 a sus ocho grupos.
 *
 * Sin esto, recortar por texto convierte `::1` en `::1::`, que no es una
 * dirección válida y hace fallar la inserción. Es exactamente el bug que
 * motivó extraer esta función.
 */
function expandIpv6(ip: string): string[] | null {
  const partes = ip.split('::');
  if (partes.length > 2) return null;

  const izquierda = partes[0] ? partes[0].split(':') : [];
  const derecha = partes[1] ? partes[1].split(':') : [];

  if (partes.length === 1) {
    return izquierda.length === 8 ? izquierda : null;
  }

  const relleno = 8 - izquierda.length - derecha.length;
  if (relleno < 0) return null;

  return [...izquierda, ...Array<string>(relleno).fill('0'), ...derecha].map((g) => g || '0');
}

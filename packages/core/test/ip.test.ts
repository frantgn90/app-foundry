import { describe, expect, it } from 'vitest';

import { truncateIp } from '../src/index.js';

describe('recorte de direcciones IP', () => {
  it('recorta IPv4 al prefijo /24', () => {
    expect(truncateIp('192.168.1.37')).toBe('192.168.1.0');
    expect(truncateIp('8.8.8.8')).toBe('8.8.8.0');
  });

  it('trata las IPv4 mapeadas en IPv6 como lo que son', () => {
    expect(truncateIp('::ffff:192.168.1.37')).toBe('192.168.1.0');
  });

  it('recorta IPv6 al prefijo /48 expandiendo la forma comprimida', () => {
    expect(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
    expect(truncateIp('2001:db8::1')).toBe('2001:db8:0::');
  });

  it('el localhost IPv6 no produce una dirección inválida (regresión)', () => {
    // Recortando por texto, `::1` se convertía en `::1::`, que no es una
    // dirección válida y hacía fallar el guardado de la sesión.
    expect(truncateIp('::1')).toBe('0:0:0::');
  });

  it('devuelve null ante lo que no sabe tratar', () => {
    expect(truncateIp(null)).toBeNull();
    expect(truncateIp(undefined)).toBeNull();
    expect(truncateIp('')).toBeNull();
    expect(truncateIp('no soy una ip')).toBeNull();
    expect(truncateIp('999.1.1.1')).toBeNull();
    expect(truncateIp('1::2::3')).toBeNull();
  });
});

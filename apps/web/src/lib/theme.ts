import { useEffect, useState } from 'react';

export type Tema = 'system' | 'light' | 'dark';

const CLAVE = 'app-foundry:tema';

export function temaGuardado(): Tema {
  try {
    const valor = localStorage.getItem(CLAVE);
    return valor === 'light' || valor === 'dark' ? valor : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Aplica el tema marcando la raíz del documento.
 *
 * Se quita el atributo para «system» en vez de calcular el valor efectivo: así
 * la hoja de estilos sigue respondiendo a `prefers-color-scheme` y el cambio de
 * tema del sistema se nota al momento, sin volver a pasar por aquí.
 */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === 'system') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', tema);
}

export function useTema(): [Tema, (tema: Tema) => void] {
  const [tema, setTema] = useState<Tema>(temaGuardado);

  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

  return [
    tema,
    (siguiente: Tema) => {
      setTema(siguiente);
      try {
        localStorage.setItem(CLAVE, siguiente);
      } catch {
        // Sin almacenamiento el tema vale para esta sesión, que es mejor que nada.
      }
    },
  ];
}

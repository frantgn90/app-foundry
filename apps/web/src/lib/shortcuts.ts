import { useEffect } from 'react';

/**
 * ¿Está la persona escribiendo?
 *
 * Los atajos de una sola tecla son cómodos hasta que aparece una «n» en mitad
 * de un documento. Antes de atender a ninguno hay que descartar que el foco esté
 * en algo donde se escribe, campos y editor de texto incluidos.
 */
function escribiendo(destino: EventTarget | null): boolean {
  if (!(destino instanceof HTMLElement)) return false;
  if (destino.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(destino.tagName);
}

export interface Atajo {
  /** La tecla, en minúscula. */
  tecla: string;
  /** Exige Cmd en Mac o Ctrl en el resto. */
  conModificador?: boolean;
  /** Si funciona incluso mientras se escribe. Solo para los que llevan modificador. */
  aunEscribiendo?: boolean;
  hacer: () => void;
}

/**
 * Registra atajos de teclado (RF-611).
 *
 * Se usa `metaKey` en Mac y `ctrlKey` en el resto, que es lo que espera cada
 * teclado. Y se llama a `preventDefault` solo cuando el atajo se atiende de
 * verdad: robarle al navegador una combinación que no vas a usar es la forma más
 * rápida de que alguien no pueda guardar la página o abrir una pestaña.
 */
export function useShortcuts(atajos: Atajo[]): void {
  useEffect(() => {
    function alPulsar(e: KeyboardEvent) {
      // Si alguien más cercano ya lo atendió —el editor tiene su propio Mod-S—
      // aquí no hay nada que hacer: repetirlo guardaría dos veces.
      if (e.defaultPrevented) return;

      const conModificador = e.metaKey || e.ctrlKey;

      for (const atajo of atajos) {
        if (e.key.toLowerCase() !== atajo.tecla) continue;
        if (Boolean(atajo.conModificador) !== conModificador) continue;
        if (e.altKey) continue;
        if (escribiendo(e.target) && !atajo.aunEscribiendo) continue;

        e.preventDefault();
        atajo.hacer();
        return;
      }
    }

    window.addEventListener('keydown', alPulsar);
    return () => {
      window.removeEventListener('keydown', alPulsar);
    };
  }, [atajos]);
}

/** Cómo se escribe el modificador en este teclado, para poder enseñarlo. */
export const TECLA_MOD = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

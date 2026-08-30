import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  disabled?: boolean;
}

/**
 * Editor de markdown sobre CodeMirror 6.
 *
 * Se usa también para **mirar** el texto en crudo, no solo para escribirlo: la
 * misma pieza con la edición apagada. Así el documento se ve igual se pueda
 * tocar o no, y pasar de leer a escribir no cambia el texto de sitio.
 *
 * CodeMirror mantiene su propio estado, así que se crea una vez y se destruye
 * al desmontar; React no vuelve a tocarlo salvo que el valor cambie **desde
 * fuera** —al restaurar una versión, por ejemplo—, y en ese caso se compara
 * antes para no interrumpir a quien está escribiendo ni moverle el cursor.
 */
export function MarkdownEditor({ value, onChange, onSave, disabled = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Las funciones se guardan en un ref para que CodeMirror no se recree cada
  // vez que el componente padre se vuelve a renderizar.
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              handlers.current.onSave();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        markdown(),
        // Los números de línea son lo que convierte esto en un editor de texto
        // a la vista: dan referencia para hablar de «lo de la línea 40» y hacen
        // evidente que se está mirando el original y no el resultado.
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        EditorView.lineWrapping,
        placeholderExt('Write your vision…'),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            handlers.current.onChange(update.state.doc.toString());
          }
        }),
        EditorView.editable.of(!disabled),
        EditorView.theme({
          '&': { fontSize: '14px', backgroundColor: 'transparent' },
          '.cm-content': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            padding: '16px 0',
            caretColor: 'var(--color-acento)',
          },
          '&.cm-focused': { outline: 'none' },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            border: 'none',
            color: 'var(--color-texto-suave)',
            // Apagados: son una referencia, no contenido. Han de poder ignorarse
            // mientras se lee y estar ahí cuando se buscan.
            opacity: '0.45',
            paddingRight: '12px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          },
          '.cm-lineNumbers .cm-gutterElement': { minWidth: '2.2ch' },
          // La línea activa solo se marca cuando se puede escribir: leyendo, un
          // resaltado que sigue al cursor del ratón distrae sin aportar nada.
          '.cm-activeLine': { backgroundColor: disabled ? 'transparent' : 'var(--color-borde)' },
          '.cm-activeLineGutter': {
            backgroundColor: 'transparent',
            color: disabled ? 'inherit' : 'var(--color-texto)',
            opacity: disabled ? '0.45' : '1',
          },
        }),
      ],
    });

    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // Deliberadamente sin `value`: recrear el editor en cada tecla perdería el
    // cursor y el historial de deshacer.
  }, [disabled]);

  // Cambios que vienen de fuera (una restauración, por ejemplo).
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={host} className="min-h-64" />;
}

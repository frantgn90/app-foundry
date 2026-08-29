import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
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
          '.cm-gutters': { display: 'none' },
          '.cm-activeLine': { backgroundColor: 'transparent' },
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

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const editorTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--foreground)',
      backgroundColor: 'transparent',
      fontSize: '14px',
    },
    '.cm-content': {
      caretColor: 'var(--accent)',
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.7',
      padding: '16px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: 'rgba(51, 153, 255, 0.2)',
      },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--text-dim)',
      border: 'none',
      paddingLeft: '8px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--text-muted)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
    '.cm-scroller': {
      overflow: 'visible',
    },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(51, 153, 255, 0.25)',
      outline: '1px solid rgba(51, 153, 255, 0.5)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
    },
    '.cm-tooltip-lint': {
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
    },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: t.string, color: 'var(--json-string)' },
  { tag: t.number, color: 'var(--json-number)' },
  { tag: t.bool, color: 'var(--json-boolean-true)' },
  { tag: t.null, color: 'var(--text-muted)' },
  { tag: t.propertyName, color: 'var(--json-key)' },
  { tag: t.punctuation, color: 'var(--text-secondary)' },
]);

export const skyStateTheme = [editorTheme, syntaxHighlighting(highlightStyle)];

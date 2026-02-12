import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { EditorView, keymap } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import { skyStateTheme } from './codemirror-theme';
import { formatJson } from '@/lib/format';

// --- Auto-format on trigger characters ---

const FORMAT_TRIGGERS = new Set(['"', ',', '}', ']']);

/**
 * Map cursor from old text to new text by counting non-whitespace characters.
 * This preserves the cursor's logical position in the JSON structure.
 */
function mapCursorPosition(oldText: string, newText: string, cursorPos: number): number {
  let nonWsCount = 0;
  for (let i = 0; i < cursorPos && i < oldText.length; i++) {
    if (oldText[i] !== ' ' && oldText[i] !== '\n' && oldText[i] !== '\t' && oldText[i] !== '\r') {
      nonWsCount++;
    }
  }

  if (nonWsCount === 0) {
    for (let i = 0; i < newText.length; i++) {
      if (newText[i] !== ' ' && newText[i] !== '\n' && newText[i] !== '\t' && newText[i] !== '\r') return i;
    }
    return 0;
  }

  const cursorAtLineStart = cursorPos > 0 && oldText[cursorPos - 1] === '\n';

  let count = 0;
  let basePos = newText.length;
  for (let i = 0; i < newText.length; i++) {
    if (newText[i] !== ' ' && newText[i] !== '\n' && newText[i] !== '\t' && newText[i] !== '\r') {
      count++;
      if (count === nonWsCount) { basePos = i + 1; break; }
    }
  }

  // After Enter, advance past the next newline to the indented start of the following line
  if (cursorAtLineStart && basePos < newText.length) {
    const nlIdx = newText.indexOf('\n', basePos);
    if (nlIdx !== -1) {
      let pos = nlIdx + 1;
      while (pos < newText.length && newText[pos] === ' ') pos++;
      return pos;
    }
  }

  return basePos;
}

function autoFormatExtension() {
  let formatting = false;

  return EditorView.updateListener.of((update) => {
    if (formatting || !update.docChanged) return;

    let hasTrigger = false;
    for (const tr of update.transactions) {
      if (!tr.isUserEvent('input')) continue;
      tr.changes.iterChanges((_fA, _tA, _fB, _tB, inserted) => {
        const text = inserted.toString();
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '\n' || FORMAT_TRIGGERS.has(text[i])) hasTrigger = true;
        }
      });
    }
    if (!hasTrigger) return;

    const doc = update.state.doc.toString();
    let formatted: string;
    try { formatted = formatJson(doc); } catch { return; }
    if (formatted === doc) return;

    const cursorPos = update.state.selection.main.head;
    const newCursorPos = mapCursorPosition(doc, formatted, cursorPos);

    formatting = true;
    update.view.dispatch({
      changes: { from: 0, to: doc.length, insert: formatted },
      selection: { anchor: newCursorPos },
      annotations: Transaction.addToHistory.of(false),
    });
    formatting = false;
  });
}

export interface CodeMirrorEditorHandle {
  format: () => void;
  getScrollDOM: () => HTMLElement | null;
}

interface CodeMirrorEditorProps {
  initialValue: string;
  readOnly: boolean;
  onDirtyChange: (dirty: boolean) => void;
  editorValueRef: React.MutableRefObject<string>;
}

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function CodeMirrorEditor({
  initialValue,
  readOnly,
  onDirtyChange,
  editorValueRef,
}, ref) {
  // Capture CodeMirror's EditorView for scroll DOM access
  const cmViewRef = useRef<EditorView | null>(null);

  // Only used to PUSH values into editor (load, revert, format).
  // Normal typing does NOT update this state.
  const [value, setValue] = useState(initialValue);

  // Tracks the "saved" value for dirty comparison
  const savedValueRef = useRef(initialValue);

  // Sync when external value changes (version switch, environment switch)
  useEffect(() => {
    savedValueRef.current = initialValue;
    editorValueRef.current = initialValue;
    setValue(initialValue);
    onDirtyChange(false);
  }, [initialValue, editorValueRef, onDirtyChange]);

  // Ref-based onChange -- does NOT call setValue (critical performance pattern)
  const onChange = useCallback(
    (val: string) => {
      editorValueRef.current = val;
      onDirtyChange(val !== savedValueRef.current);
    },
    [editorValueRef, onDirtyChange],
  );

  // Format JSON via Shift-Alt-F
  const handleFormat = useCallback(() => {
    try {
      const formatted = formatJson(editorValueRef.current);
      editorValueRef.current = formatted;
      setValue(formatted);
      onDirtyChange(formatted !== savedValueRef.current);
    } catch {
      // Invalid JSON -- do nothing, linter shows the error
    }
    return true;
  }, [editorValueRef, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    format: () => { handleFormat(); },
    getScrollDOM: () => cmViewRef.current?.scrollDOM ?? null,
  }), [handleFormat]);

  const autoFormat = useMemo(() => autoFormatExtension(), []);

  const extensions = useMemo(
    () => [
      json(),
      linter(jsonParseLinter()),
      lintGutter(),
      // eslint-disable-next-line react-hooks/refs -- handleFormat is only called on keypress, not during render
      keymap.of([{ key: 'Shift-Alt-f', run: () => handleFormat() }]),
      autoFormat,
      EditorView.lineWrapping,
    ],
    [handleFormat, autoFormat],
  );

  return (
    <div className={`overflow-hidden${readOnly ? ' opacity-60' : ''}`}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={skyStateTheme}
        readOnly={readOnly}
        onCreateEditor={(view) => { cmViewRef.current = view; }}
        height="auto"
        minHeight="200px"
        basicSetup={{
          lineNumbers: true,
          bracketMatching: true,
          closeBrackets: true,
          foldGutter: false,
          autocompletion: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          tabSize: 2,
        }}
      />
    </div>
  );
});

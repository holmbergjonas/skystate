import { CodeMirrorEditor } from './CodeMirrorEditor';
import type { CodeMirrorEditorHandle } from './CodeMirrorEditor';

interface EditorViewProps {
  displayedState: string;
  isEditing: boolean;
  editorRef: React.RefObject<CodeMirrorEditorHandle | null>;
  editorValueRef: React.MutableRefObject<string>;
  selectedVersionId: string;
  onDirtyChange: (dirty: boolean) => void;
  header?: React.ReactNode;
  children?: React.ReactNode;
}

export function EditorView({
  displayedState,
  isEditing,
  editorRef,
  editorValueRef,
  selectedVersionId,
  onDirtyChange,
  header,
  children,
}: EditorViewProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {header && (
          <div className="sticky top-0 z-10 bg-[var(--surface-translucent)]">
            {header}
          </div>
        )}
        {children ?? (
          <CodeMirrorEditor
            key={`${selectedVersionId}-${isEditing}`}
            ref={editorRef}
            initialValue={displayedState}
            readOnly={!isEditing}
            onDirtyChange={onDirtyChange}
            editorValueRef={editorValueRef}
          />
        )}
      </div>
    </div>
  );
}

import { useState, useCallback } from 'react';
import { useBeforeUnload } from 'react-router';

interface UseEditorGuardsOptions {
  isDirty: boolean;
  onDiscard?: () => void;
}

interface UseEditorGuardsReturn {
  guardNavigation: (action: () => void) => void;
  confirmDialogOpen: boolean;
  confirmProceed: () => void;
  confirmCancel: () => void;
}

export function useEditorGuards({ isDirty, onDiscard }: UseEditorGuardsOptions): UseEditorGuardsReturn {
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const confirmDialogOpen = pendingAction !== null;

  useBeforeUnload(
    useCallback(
      (e: BeforeUnloadEvent) => {
        if (isDirty) {
          e.preventDefault();
        }
      },
      [isDirty],
    ),
  );

  const guardNavigation = useCallback(
    (action: () => void) => {
      if (isDirty) {
        setPendingAction(() => action);
      } else {
        action();
      }
    },
    [isDirty],
  );

  const confirmProceed = useCallback(() => {
    onDiscard?.();
    pendingAction?.();
    setPendingAction(null);
  }, [pendingAction, onDiscard]);

  const confirmCancel = useCallback(() => {
    setPendingAction(null);
  }, []);

  return { guardNavigation, confirmDialogOpen, confirmProceed, confirmCancel };
}

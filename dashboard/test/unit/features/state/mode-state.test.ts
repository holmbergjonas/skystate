import { describe, it, expect } from 'vitest';
import {
  tabReducer,
  INITIAL_STATE,
  IDLE_OP,
  PENDING_OP,
  deriveView,
  type TabState,
  type ActiveMode,
  type TabAction,
} from '@/features/state/mode-state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function editingState(overrides?: Partial<Extract<ActiveMode, { mode: 'editing' }>>): TabState {
  return {
    ...INITIAL_STATE,
    activeMode: {
      mode: 'editing',
      isDirty: false,
      isJsonValid: true,
      bumpType: 'patch',
      push: IDLE_OP,
      ...overrides,
    },
  };
}

function rollbackState(overrides?: Partial<Extract<ActiveMode, { mode: 'rollback' }>>): TabState {
  return {
    ...INITIAL_STATE,
    selectedIndex: 1,
    activeMode: {
      mode: 'rollback',
      op: IDLE_OP,
      ...overrides,
    },
  };
}

function promoteState(overrides?: Partial<Extract<ActiveMode, { mode: 'promote' }>>): TabState {
  return {
    ...INITIAL_STATE,
    activeMode: {
      mode: 'promote',
      targetEnvId: 'env-2',
      target: { status: 'loaded', latest: null, isFresh: true },
      bumpType: 'patch',
      op: IDLE_OP,
      ...overrides,
    },
  };
}

function compareState(): TabState {
  return {
    ...INITIAL_STATE,
    activeMode: {
      mode: 'compare',
      target: { env: 'production', versionIndex: 0, versionStr: '0.0.1', state: '{}' },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: Valid transitions
// ---------------------------------------------------------------------------

describe('tabReducer', () => {
  describe('SELECT_VERSION', () => {
    it('updates selectedIndex from any mode', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'SELECT_VERSION', index: 3 });
      expect(result.selectedIndex).toBe(3);
      expect(result.activeMode).toBeNull();
    });

    it('updates selectedIndex in editing mode', () => {
      const result = tabReducer(editingState(), { type: 'SELECT_VERSION', index: 2 });
      expect(result.selectedIndex).toBe(2);
      expect(result.activeMode?.mode).toBe('editing');
    });
  });

  describe('START_EDITING', () => {
    it('transitions from viewing to editing', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'START_EDITING' });
      expect(result.activeMode).toEqual({
        mode: 'editing',
        isDirty: false,
        isJsonValid: true,
        bumpType: 'patch',
        push: IDLE_OP,
      });
    });

    it('is a no-op from rollback mode', () => {
      const state = rollbackState();
      const result = tabReducer(state, { type: 'START_EDITING' });
      expect(result).toBe(state);
    });

    it('is a no-op from promote mode', () => {
      const state = promoteState();
      const result = tabReducer(state, { type: 'START_EDITING' });
      expect(result).toBe(state);
    });

    it('is a no-op from compare mode', () => {
      const state = compareState();
      const result = tabReducer(state, { type: 'START_EDITING' });
      expect(result).toBe(state);
    });

    it('is a no-op if already editing', () => {
      const state = editingState();
      const result = tabReducer(state, { type: 'START_EDITING' });
      expect(result).toBe(state);
    });
  });

  describe('EXIT_EDITING', () => {
    it('returns to viewing', () => {
      const state = editingState();
      const result = tabReducer(state, { type: 'EXIT_EDITING' });
      expect(result.activeMode).toBeNull();
    });

    it('is a no-op from viewing mode', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'EXIT_EDITING' });
      expect(result).toBe(INITIAL_STATE);
    });
  });

  describe('SET_DIRTY', () => {
    it('updates isDirty and isJsonValid in editing mode', () => {
      const result = tabReducer(editingState(), { type: 'SET_DIRTY', isDirty: true, isJsonValid: false });
      expect(result.activeMode).toMatchObject({ isDirty: true, isJsonValid: false });
    });

    it('is a no-op from viewing mode', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'SET_DIRTY', isDirty: true, isJsonValid: true });
      expect(result).toBe(INITIAL_STATE);
    });
  });

  describe('SET_BUMP_TYPE', () => {
    it('updates bumpType in editing mode', () => {
      const result = tabReducer(editingState(), { type: 'SET_BUMP_TYPE', bumpType: 'major' });
      expect(result.activeMode).toMatchObject({ bumpType: 'major' });
    });

    it('is a no-op from rollback mode', () => {
      const state = rollbackState();
      const result = tabReducer(state, { type: 'SET_BUMP_TYPE', bumpType: 'major' });
      expect(result).toBe(state);
    });
  });

  describe('PUSH_START', () => {
    it('sets push to pending in editing mode', () => {
      const result = tabReducer(editingState(), { type: 'PUSH_START' });
      expect(result.activeMode).toMatchObject({ push: PENDING_OP });
    });

    it('is a no-op from viewing mode', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'PUSH_START' });
      expect(result).toBe(INITIAL_STATE);
    });
  });

  describe('PUSH_SUCCESS', () => {
    it('resets to viewing and resets selectedIndex to 0', () => {
      const state = { ...editingState({ push: PENDING_OP }), selectedIndex: 2 };
      const result = tabReducer(state, { type: 'PUSH_SUCCESS' });
      expect(result.selectedIndex).toBe(0);
      expect(result.activeMode).toBeNull();
    });

    it('is a no-op from viewing mode', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'PUSH_SUCCESS' });
      expect(result).toBe(INITIAL_STATE);
    });
  });

  describe('PUSH_ERROR', () => {
    it('sets push error in editing mode', () => {
      const state = editingState({ push: PENDING_OP });
      const result = tabReducer(state, { type: 'PUSH_ERROR', error: 'Network error' });
      expect(result.activeMode).toMatchObject({ push: { status: 'error', error: 'Network error' } });
    });

    it('is a no-op from rollback mode', () => {
      const state = rollbackState();
      const result = tabReducer(state, { type: 'PUSH_ERROR', error: 'fail' });
      expect(result).toBe(state);
    });
  });

  describe('SET_COMPARE', () => {
    it('enters compare mode with target', () => {
      const target = { env: 'staging', versionIndex: 0, versionStr: '1.0.0', state: '{"a":1}' };
      const result = tabReducer(INITIAL_STATE, { type: 'SET_COMPARE', target });
      expect(result.activeMode).toEqual({ mode: 'compare', target });
    });

    it('can overwrite existing compare target', () => {
      const state = compareState();
      const newTarget = { env: 'staging', versionIndex: 1, versionStr: '0.0.2', state: '{"b":2}' };
      const result = tabReducer(state, { type: 'SET_COMPARE', target: newTarget });
      expect(result.activeMode).toEqual({ mode: 'compare', target: newTarget });
    });
  });

  describe('ENTER_ROLLBACK', () => {
    it('enters rollback mode and sets selectedIndex', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'ENTER_ROLLBACK', selectedIndex: 2 });
      expect(result.selectedIndex).toBe(2);
      expect(result.activeMode).toEqual({ mode: 'rollback', op: IDLE_OP });
    });
  });

  describe('ROLLBACK_START', () => {
    it('sets op to pending in rollback mode', () => {
      const result = tabReducer(rollbackState(), { type: 'ROLLBACK_START' });
      expect(result.activeMode).toMatchObject({ op: PENDING_OP });
    });

    it('is a no-op from editing mode', () => {
      const state = editingState();
      const result = tabReducer(state, { type: 'ROLLBACK_START' });
      expect(result).toBe(state);
    });
  });

  describe('ROLLBACK_SUCCESS', () => {
    it('returns to viewing and resets selectedIndex', () => {
      const state = { ...rollbackState({ op: PENDING_OP }), selectedIndex: 2 };
      const result = tabReducer(state, { type: 'ROLLBACK_SUCCESS' });
      expect(result.selectedIndex).toBe(0);
      expect(result.activeMode).toBeNull();
    });

    it('is a no-op from editing mode', () => {
      const state = editingState();
      const result = tabReducer(state, { type: 'ROLLBACK_SUCCESS' });
      expect(result).toBe(state);
    });
  });

  describe('ROLLBACK_ERROR', () => {
    it('sets op error in rollback mode', () => {
      const state = rollbackState({ op: PENDING_OP });
      const result = tabReducer(state, { type: 'ROLLBACK_ERROR', error: 'Not found' });
      expect(result.activeMode).toMatchObject({ op: { status: 'error', error: 'Not found' } });
    });

    it('is a no-op from promote mode', () => {
      const state = promoteState();
      const result = tabReducer(state, { type: 'ROLLBACK_ERROR', error: 'fail' });
      expect(result).toBe(state);
    });
  });

  describe('ENTER_PROMOTE', () => {
    it('enters promote mode with loading target', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'ENTER_PROMOTE', targetEnvId: 'env-2' });
      expect(result.activeMode).toEqual({
        mode: 'promote',
        targetEnvId: 'env-2',
        target: { status: 'loading' },
        bumpType: 'patch',
        op: IDLE_OP,
      });
    });
  });

  describe('PROMOTE_TARGET_LOADED', () => {
    it('sets loaded target in promote mode', () => {
      const state: TabState = {
        ...INITIAL_STATE,
        activeMode: {
          mode: 'promote',
          targetEnvId: 'env-2',
          target: { status: 'loading' },
          bumpType: 'patch',
          op: IDLE_OP,
        },
      };
      const result = tabReducer(state, { type: 'PROMOTE_TARGET_LOADED', latest: null, isFresh: true });
      expect(result.activeMode).toMatchObject({
        target: { status: 'loaded', latest: null, isFresh: true },
      });
    });

    it('is a no-op from viewing mode', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'PROMOTE_TARGET_LOADED', latest: null, isFresh: true });
      expect(result).toBe(INITIAL_STATE);
    });
  });

  describe('PROMOTE_TARGET_ERROR', () => {
    it('sets error and loaded target in promote mode', () => {
      const state: TabState = {
        ...INITIAL_STATE,
        activeMode: {
          mode: 'promote',
          targetEnvId: 'env-2',
          target: { status: 'loading' },
          bumpType: 'patch',
          op: IDLE_OP,
        },
      };
      const result = tabReducer(state, { type: 'PROMOTE_TARGET_ERROR', error: 'Failed' });
      expect(result.activeMode).toMatchObject({
        target: { status: 'loaded', latest: null, isFresh: false },
        op: { status: 'error', error: 'Failed' },
      });
    });

    it('is a no-op from rollback mode', () => {
      const state = rollbackState();
      const result = tabReducer(state, { type: 'PROMOTE_TARGET_ERROR', error: 'fail' });
      expect(result).toBe(state);
    });
  });

  describe('SET_PROMOTE_BUMP_TYPE', () => {
    it('updates bumpType in promote mode', () => {
      const result = tabReducer(promoteState(), { type: 'SET_PROMOTE_BUMP_TYPE', bumpType: 'minor' });
      expect(result.activeMode).toMatchObject({ bumpType: 'minor' });
    });

    it('is a no-op from editing mode', () => {
      const state = editingState();
      const result = tabReducer(state, { type: 'SET_PROMOTE_BUMP_TYPE', bumpType: 'minor' });
      expect(result).toBe(state);
    });
  });

  describe('PROMOTE_START', () => {
    it('sets op to pending in promote mode', () => {
      const result = tabReducer(promoteState(), { type: 'PROMOTE_START' });
      expect(result.activeMode).toMatchObject({ op: PENDING_OP });
    });

    it('is a no-op from viewing mode', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'PROMOTE_START' });
      expect(result).toBe(INITIAL_STATE);
    });
  });

  describe('PROMOTE_SUCCESS', () => {
    it('returns to initial state', () => {
      const state = promoteState({ op: PENDING_OP });
      const result = tabReducer(state, { type: 'PROMOTE_SUCCESS' });
      expect(result).toEqual(INITIAL_STATE);
    });

    it('is a no-op from editing mode', () => {
      const state = editingState();
      const result = tabReducer(state, { type: 'PROMOTE_SUCCESS' });
      expect(result).toBe(state);
    });
  });

  describe('PROMOTE_ERROR', () => {
    it('sets op error in promote mode', () => {
      const state = promoteState({ op: PENDING_OP });
      const result = tabReducer(state, { type: 'PROMOTE_ERROR', error: 'Conflict' });
      expect(result.activeMode).toMatchObject({ op: { status: 'error', error: 'Conflict' } });
    });

    it('is a no-op from rollback mode', () => {
      const state = rollbackState();
      const result = tabReducer(state, { type: 'PROMOTE_ERROR', error: 'fail' });
      expect(result).toBe(state);
    });
  });

  describe('RESET_FOR_ENV_CHANGE', () => {
    it('from viewing mode: resets selectedIndex to 0, activeMode stays null', () => {
      const state = { ...INITIAL_STATE, selectedIndex: 3 };
      const result = tabReducer(state, { type: 'RESET_FOR_ENV_CHANGE', newEnvId: 'env-x' });
      expect(result.selectedIndex).toBe(0);
      expect(result.activeMode).toBeNull();
    });

    it('from editing mode: returns INITIAL_STATE (editor content is env-specific)', () => {
      const result = tabReducer(editingState(), { type: 'RESET_FOR_ENV_CHANGE', newEnvId: 'env-x' });
      expect(result).toEqual(INITIAL_STATE);
    });

    it('from compare mode: preserves compare mode, resets selectedIndex to 0', () => {
      const state = { ...compareState(), selectedIndex: 2 };
      const result = tabReducer(state, { type: 'RESET_FOR_ENV_CHANGE', newEnvId: 'env-x' });
      expect(result.selectedIndex).toBe(0);
      expect(result.activeMode).toEqual(state.activeMode);
      expect(result.activeMode?.mode).toBe('compare');
    });

    it('from rollback mode: preserves rollback, resets selectedIndex to 1, resets op to IDLE_OP', () => {
      const state = rollbackState({ op: { status: 'error', error: 'some error' } });
      const result = tabReducer({ ...state, selectedIndex: 3 }, { type: 'RESET_FOR_ENV_CHANGE', newEnvId: 'env-x' });
      expect(result.selectedIndex).toBe(1);
      expect(result.activeMode).toEqual({ mode: 'rollback', op: IDLE_OP });
    });

    it('from promote mode with different target env: preserves promote with target loading, selectedIndex 0', () => {
      const state = promoteState({ op: { status: 'error', error: 'err' } });
      const result = tabReducer({ ...state, selectedIndex: 2 }, { type: 'RESET_FOR_ENV_CHANGE', newEnvId: 'env-other' });
      expect(result.selectedIndex).toBe(0);
      expect(result.activeMode).toMatchObject({
        mode: 'promote',
        targetEnvId: 'env-2',
        target: { status: 'loading' },
        op: IDLE_OP,
      });
    });

    it('from promote mode with same target env as newEnvId: returns INITIAL_STATE (self-promote guard)', () => {
      const state = promoteState(); // targetEnvId: 'env-2'
      const result = tabReducer(state, { type: 'RESET_FOR_ENV_CHANGE', newEnvId: 'env-2' });
      expect(result).toEqual(INITIAL_STATE);
    });
  });

  describe('RESET', () => {
    it('always returns INITIAL_STATE from any mode', () => {
      expect(tabReducer(editingState(), { type: 'RESET' })).toEqual(INITIAL_STATE);
      expect(tabReducer(rollbackState(), { type: 'RESET' })).toEqual(INITIAL_STATE);
      expect(tabReducer(promoteState(), { type: 'RESET' })).toEqual(INITIAL_STATE);
      expect(tabReducer(compareState(), { type: 'RESET' })).toEqual(INITIAL_STATE);
    });

    it('resets modified selectedIndex', () => {
      const state = { ...editingState(), selectedIndex: 5 };
      const result = tabReducer(state, { type: 'RESET' });
      expect(result.selectedIndex).toBe(0);
    });
  });

  describe('RETURN_TO_EDITOR', () => {
    it('returns to viewing and resets selectedIndex', () => {
      const state = { ...rollbackState(), selectedIndex: 3 };
      const result = tabReducer(state, { type: 'RETURN_TO_EDITOR' });
      expect(result.selectedIndex).toBe(0);
      expect(result.activeMode).toBeNull();
    });
  });

  describe('unknown action', () => {
    it('returns state unchanged', () => {
      const result = tabReducer(INITIAL_STATE, { type: 'UNKNOWN' } as unknown as TabAction);
      expect(result).toBe(INITIAL_STATE);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: deriveView
// ---------------------------------------------------------------------------

describe('deriveView', () => {
  it('viewing → editor, not editing', () => {
    const view = deriveView(null);
    expect(view).toEqual({ mode: 'editor', editing: false });
  });

  it('editing → editor, editing with derived fields', () => {
    const view = deriveView({
      mode: 'editing', isDirty: true, isJsonValid: true, bumpType: 'minor', push: IDLE_OP,
    });
    expect(view).toEqual({
      mode: 'editor', editing: true,
      isDirty: true, isJsonValid: true, bumpType: 'minor',
      isPushing: false, pushError: null, canPush: true,
    });
  });

  it('editing canPush is false when not dirty', () => {
    const view = deriveView({
      mode: 'editing', isDirty: false, isJsonValid: true, bumpType: 'patch', push: IDLE_OP,
    });
    expect(view.mode).toBe('editor');
    if (view.mode === 'editor' && view.editing) {
      expect(view.canPush).toBe(false);
    }
  });

  it('editing canPush is false when JSON invalid', () => {
    const view = deriveView({
      mode: 'editing', isDirty: true, isJsonValid: false, bumpType: 'patch', push: IDLE_OP,
    });
    if (view.mode === 'editor' && view.editing) {
      expect(view.canPush).toBe(false);
    }
  });

  it('editing canPush is false when push pending', () => {
    const view = deriveView({
      mode: 'editing', isDirty: true, isJsonValid: true, bumpType: 'patch', push: PENDING_OP,
    });
    if (view.mode === 'editor' && view.editing) {
      expect(view.canPush).toBe(false);
      expect(view.isPushing).toBe(true);
    }
  });

  it('editing shows push error', () => {
    const view = deriveView({
      mode: 'editing', isDirty: true, isJsonValid: true, bumpType: 'patch',
      push: { status: 'error', error: 'Network fail' },
    });
    if (view.mode === 'editor' && view.editing) {
      expect(view.pushError).toBe('Network fail');
      expect(view.canPush).toBe(true); // can retry
    }
  });

  it('compare → compare with target', () => {
    const target = { env: 'staging', versionIndex: 0, versionStr: '1.0.0', state: '{}' };
    const view = deriveView({ mode: 'compare', target });
    expect(view).toEqual({ mode: 'compare', target });
  });

  it('rollback → rollback with derived fields', () => {
    const view = deriveView({ mode: 'rollback', op: IDLE_OP });
    expect(view).toEqual({ mode: 'rollback', isRollingBack: false, rollbackError: null });
  });

  it('rollback pending', () => {
    const view = deriveView({ mode: 'rollback', op: PENDING_OP });
    expect(view.mode).toBe('rollback');
    if (view.mode === 'rollback') {
      expect(view.isRollingBack).toBe(true);
    }
  });

  it('rollback error', () => {
    const view = deriveView({ mode: 'rollback', op: { status: 'error', error: 'Not found' } });
    if (view.mode === 'rollback') {
      expect(view.rollbackError).toBe('Not found');
    }
  });

  it('promote loading', () => {
    const view = deriveView({
      mode: 'promote', targetEnvId: 'env-2', target: { status: 'loading' },
      bumpType: 'patch', op: IDLE_OP,
    });
    expect(view.mode).toBe('promote');
    if (view.mode === 'promote') {
      expect(view.loadingTarget).toBe(true);
      expect(view.targetLatest).toBeNull();
      expect(view.targetIsFresh).toBe(false);
    }
  });

  it('promote loaded with target', () => {
    const latest = { projectStateId: 'ps-1', environmentId: 'env-2', major: 1, minor: 0, patch: 0, state: '{}', comment: null, createdAt: '', stateSizeBytes: 2, version: { major: 1, minor: 0, patch: 0 } };
    const view = deriveView({
      mode: 'promote', targetEnvId: 'env-2',
      target: { status: 'loaded', latest, isFresh: false },
      bumpType: 'minor', op: IDLE_OP,
    });
    if (view.mode === 'promote') {
      expect(view.loadingTarget).toBe(false);
      expect(view.targetLatest).toBe(latest);
      expect(view.targetIsFresh).toBe(false);
      expect(view.bumpType).toBe('minor');
      expect(view.isPromoting).toBe(false);
      expect(view.promoteError).toBeNull();
    }
  });

  it('promote fresh environment', () => {
    const view = deriveView({
      mode: 'promote', targetEnvId: 'env-2',
      target: { status: 'loaded', latest: null, isFresh: true },
      bumpType: 'patch', op: IDLE_OP,
    });
    if (view.mode === 'promote') {
      expect(view.targetIsFresh).toBe(true);
      expect(view.targetLatest).toBeNull();
    }
  });

  it('promote error', () => {
    const view = deriveView({
      mode: 'promote', targetEnvId: 'env-2',
      target: { status: 'loaded', latest: null, isFresh: false },
      bumpType: 'patch', op: { status: 'error', error: 'Conflict' },
    });
    if (view.mode === 'promote') {
      expect(view.isPromoting).toBe(false);
      expect(view.promoteError).toBe('Conflict');
    }
  });

  it('promote pending', () => {
    const view = deriveView({
      mode: 'promote', targetEnvId: 'env-2',
      target: { status: 'loaded', latest: null, isFresh: true },
      bumpType: 'patch', op: PENDING_OP,
    });
    if (view.mode === 'promote') {
      expect(view.isPromoting).toBe(true);
    }
  });
});

import type { BumpType } from './push-utils';
import type { CompareTarget } from './ActionModeGroup';
import type { ProjectState } from '@/api/types';

// ---------------------------------------------------------------------------
// Async operation state
// ---------------------------------------------------------------------------

export type AsyncOp =
  | { status: 'idle'; error: null }
  | { status: 'pending'; error: null }
  | { status: 'error'; error: string };

export const IDLE_OP: AsyncOp = { status: 'idle', error: null };
export const PENDING_OP: AsyncOp = { status: 'pending', error: null };

// ---------------------------------------------------------------------------
// Promote target loading state
// ---------------------------------------------------------------------------

export type PromoteTarget =
  | { status: 'loading' }
  | { status: 'loaded'; latest: ProjectState | null; isFresh: boolean };

// ---------------------------------------------------------------------------
// Discriminated union: ActiveMode (null = viewing)
// ---------------------------------------------------------------------------

export type ActiveMode =
  | { mode: 'editing'; isDirty: boolean; isJsonValid: boolean; bumpType: BumpType; push: AsyncOp }
  | { mode: 'compare'; target: CompareTarget }
  | { mode: 'rollback'; op: AsyncOp }
  | { mode: 'promote'; targetEnvId: string; target: PromoteTarget; bumpType: BumpType; op: AsyncOp };

// ---------------------------------------------------------------------------
// Top-level tab state
// ---------------------------------------------------------------------------

export interface TabState {
  selectedIndex: number;
  activeMode: ActiveMode | null;
}

export const INITIAL_STATE: TabState = {
  selectedIndex: 0,
  activeMode: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type TabAction =
  // Version
  | { type: 'SELECT_VERSION'; index: number }
  // Editing lifecycle
  | { type: 'START_EDITING' }
  | { type: 'EXIT_EDITING' }
  | { type: 'SET_DIRTY'; isDirty: boolean; isJsonValid: boolean }
  | { type: 'SET_BUMP_TYPE'; bumpType: BumpType }
  // Push
  | { type: 'PUSH_START' }
  | { type: 'PUSH_SUCCESS' }
  | { type: 'PUSH_ERROR'; error: string }
  // Compare
  | { type: 'SET_COMPARE'; target: CompareTarget }
  // Rollback
  | { type: 'ENTER_ROLLBACK'; selectedIndex: number }
  | { type: 'ROLLBACK_START' }
  | { type: 'ROLLBACK_SUCCESS' }
  | { type: 'ROLLBACK_ERROR'; error: string }
  // Promote
  | { type: 'ENTER_PROMOTE'; targetEnvId: string }
  | { type: 'PROMOTE_TARGET_LOADED'; latest: ProjectState | null; isFresh: boolean }
  | { type: 'PROMOTE_TARGET_ERROR'; error: string }
  | { type: 'SET_PROMOTE_BUMP_TYPE'; bumpType: BumpType }
  | { type: 'PROMOTE_START' }
  | { type: 'PROMOTE_SUCCESS' }
  | { type: 'PROMOTE_ERROR'; error: string }
  // Global
  | { type: 'RESET' }
  | { type: 'RESET_FOR_ENV_CHANGE'; newEnvId: string }
  | { type: 'RETURN_TO_EDITOR' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function tabReducer(state: TabState, action: TabAction): TabState {
  const { activeMode } = state;

  switch (action.type) {
    // -- Version ---------------------------------------------------------------
    case 'SELECT_VERSION':
      return { ...state, selectedIndex: action.index };

    // -- Editing lifecycle -----------------------------------------------------
    case 'START_EDITING':
      if (activeMode !== null) return state;
      return {
        ...state,
        activeMode: {
          mode: 'editing',
          isDirty: false,
          isJsonValid: true,
          bumpType: 'patch',
          push: IDLE_OP,
        },
      };

    case 'EXIT_EDITING':
      if (activeMode?.mode !== 'editing') return state;
      return {
        ...state,
        activeMode: null,
      };

    case 'SET_DIRTY':
      if (activeMode?.mode !== 'editing') return state;
      return {
        ...state,
        activeMode: { ...activeMode, isDirty: action.isDirty, isJsonValid: action.isJsonValid },
      };

    case 'SET_BUMP_TYPE':
      if (activeMode?.mode !== 'editing') return state;
      return {
        ...state,
        activeMode: { ...activeMode, bumpType: action.bumpType },
      };

    // -- Push ------------------------------------------------------------------
    case 'PUSH_START':
      if (activeMode?.mode !== 'editing') return state;
      return {
        ...state,
        activeMode: { ...activeMode, push: PENDING_OP },
      };

    case 'PUSH_SUCCESS':
      if (activeMode?.mode !== 'editing') return state;
      return {
        ...state,
        selectedIndex: 0,
        activeMode: null,
      };

    case 'PUSH_ERROR':
      if (activeMode?.mode !== 'editing') return state;
      return {
        ...state,
        activeMode: { ...activeMode, push: { status: 'error', error: action.error } },
      };

    // -- Compare ---------------------------------------------------------------
    case 'SET_COMPARE':
      return {
        ...state,
        activeMode: { mode: 'compare', target: action.target },
      };

    // -- Rollback --------------------------------------------------------------
    case 'ENTER_ROLLBACK':
      return {
        ...state,
        selectedIndex: action.selectedIndex,
        activeMode: { mode: 'rollback', op: IDLE_OP },
      };

    case 'ROLLBACK_START':
      if (activeMode?.mode !== 'rollback') return state;
      return {
        ...state,
        activeMode: { ...activeMode, op: PENDING_OP },
      };

    case 'ROLLBACK_SUCCESS':
      if (activeMode?.mode !== 'rollback') return state;
      return {
        ...state,
        selectedIndex: 0,
        activeMode: null,
      };

    case 'ROLLBACK_ERROR':
      if (activeMode?.mode !== 'rollback') return state;
      return {
        ...state,
        activeMode: { ...activeMode, op: { status: 'error', error: action.error } },
      };

    // -- Promote ---------------------------------------------------------------
    case 'ENTER_PROMOTE':
      return {
        ...state,
        activeMode: {
          mode: 'promote',
          targetEnvId: action.targetEnvId,
          target: { status: 'loading' },
          bumpType: 'patch',
          op: IDLE_OP,
        },
      };

    case 'PROMOTE_TARGET_LOADED':
      if (activeMode?.mode !== 'promote') return state;
      return {
        ...state,
        activeMode: {
          ...activeMode,
          target: { status: 'loaded', latest: action.latest, isFresh: action.isFresh },
        },
      };

    case 'PROMOTE_TARGET_ERROR':
      if (activeMode?.mode !== 'promote') return state;
      return {
        ...state,
        activeMode: {
          ...activeMode,
          target: { status: 'loaded', latest: null, isFresh: false },
          op: { status: 'error', error: action.error },
        },
      };

    case 'SET_PROMOTE_BUMP_TYPE':
      if (activeMode?.mode !== 'promote') return state;
      if (activeMode.bumpType === action.bumpType) return state;
      return {
        ...state,
        activeMode: { ...activeMode, bumpType: action.bumpType },
      };

    case 'PROMOTE_START':
      if (activeMode?.mode !== 'promote') return state;
      return {
        ...state,
        activeMode: { ...activeMode, op: PENDING_OP },
      };

    case 'PROMOTE_SUCCESS':
      if (activeMode?.mode !== 'promote') return state;
      return INITIAL_STATE;

    case 'PROMOTE_ERROR':
      if (activeMode?.mode !== 'promote') return state;
      return {
        ...state,
        activeMode: { ...activeMode, op: { status: 'error', error: action.error } },
      };

    // -- Global ----------------------------------------------------------------
    case 'RESET':
      return INITIAL_STATE;

    case 'RESET_FOR_ENV_CHANGE': {
      // No active mode: same as RESET
      if (!activeMode) {
        return { selectedIndex: 0, activeMode: null };
      }
      // Editing: reset fully (editor content is env-specific)
      if (activeMode.mode === 'editing') {
        return INITIAL_STATE;
      }
      // Compare: preserve -- CompareTarget has state data embedded
      if (activeMode.mode === 'compare') {
        return { selectedIndex: 0, activeMode: state.activeMode };
      }
      // Rollback: preserve mode, reset index to 1 (can't rollback to latest), clear op
      if (activeMode.mode === 'rollback') {
        return { selectedIndex: 1, activeMode: { mode: 'rollback', op: IDLE_OP } };
      }
      // Promote: if target env is the new env, self-promote is invalid -- exit
      if (activeMode.mode === 'promote') {
        if (action.newEnvId === activeMode.targetEnvId) {
          return INITIAL_STATE;
        }
        // Preserve promote but reset target to loading (re-fetch for new source context)
        return {
          selectedIndex: 0,
          activeMode: { ...activeMode, target: { status: 'loading' }, op: IDLE_OP },
        };
      }
      return INITIAL_STATE;
    }

    case 'RETURN_TO_EDITOR':
      return {
        ...state,
        selectedIndex: 0,
        activeMode: null,
      };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Derived view union
// ---------------------------------------------------------------------------

type ViewingView = { mode: 'editor'; editing: false };

type EditingView = {
  mode: 'editor';
  editing: true;
  isDirty: boolean;
  isJsonValid: boolean;
  bumpType: BumpType;
  isPushing: boolean;
  pushError: string | null;
  canPush: boolean;
};

type CompareView = { mode: 'compare'; target: CompareTarget };

type RollbackView = {
  mode: 'rollback';
  isRollingBack: boolean;
  rollbackError: string | null;
};

type PromoteView = {
  mode: 'promote';
  targetEnvId: string;
  loadingTarget: boolean;
  targetLatest: ProjectState | null;
  targetIsFresh: boolean;
  bumpType: BumpType;
  isPromoting: boolean;
  promoteError: string | null;
};

export type DerivedView =
  | ViewingView | EditingView | CompareView | RollbackView | PromoteView;

export function deriveView(am: ActiveMode | null): DerivedView {
  if (!am) return { mode: 'editor', editing: false };
  switch (am.mode) {
    case 'editing':
      return {
        mode: 'editor',
        editing: true,
        isDirty: am.isDirty,
        isJsonValid: am.isJsonValid,
        bumpType: am.bumpType,
        isPushing: am.push.status === 'pending',
        pushError: am.push.status === 'error' ? am.push.error : null,
        canPush: am.isDirty && am.isJsonValid && am.push.status !== 'pending',
      };
    case 'compare':
      return { mode: 'compare', target: am.target };
    case 'rollback':
      return {
        mode: 'rollback',
        isRollingBack: am.op.status === 'pending',
        rollbackError: am.op.status === 'error' ? am.op.error : null,
      };
    case 'promote':
      return {
        mode: 'promote',
        targetEnvId: am.targetEnvId,
        loadingTarget: am.target.status === 'loading',
        targetLatest: am.target.status === 'loaded' ? am.target.latest : null,
        targetIsFresh: am.target.status === 'loaded' ? am.target.isFresh : false,
        bumpType: am.bumpType,
        isPromoting: am.op.status === 'pending',
        promoteError: am.op.status === 'error' ? am.op.error : null,
      };
  }
}

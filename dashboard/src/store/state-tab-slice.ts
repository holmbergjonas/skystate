import type { SliceCreator } from './types';
import type { TabState, TabAction } from '@/features/state/mode-state';
import { tabReducer, INITIAL_STATE } from '@/features/state/mode-state';

export interface StateTabSlice {
  tabState: TabState;
  tabDispatch: (action: TabAction) => void;
}

export const createStateTabSlice: SliceCreator<StateTabSlice> = (set) => ({
  tabState: INITIAL_STATE,
  tabDispatch: (action: TabAction) =>
    set((s) => ({ tabState: tabReducer(s.tabState, action) })),
});

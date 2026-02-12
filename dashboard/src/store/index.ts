import { create } from 'zustand';
import type { StoreState } from './types';
import { createAuthSlice } from './auth-slice';
import { createProjectsSlice } from './projects-slice';
import { createEnvironmentsSlice } from './environments-slice';
import { createStatesSlice } from './states-slice';
import { createBillingSlice } from './billing-slice';
import { createStateTabSlice } from './state-tab-slice';

export const useStore = create<StoreState>()((...a) => ({
  ...createAuthSlice(...a),
  ...createProjectsSlice(...a),
  ...createEnvironmentsSlice(...a),
  ...createStatesSlice(...a),
  ...createBillingSlice(...a),
  ...createStateTabSlice(...a),
}));

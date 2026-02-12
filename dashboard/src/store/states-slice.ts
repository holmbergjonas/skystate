import type { SliceCreator, StatesSlice } from './types';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

export const createStatesSlice: SliceCreator<StatesSlice> = (set, get) => {
  let statesAbort: AbortController | null = null;

  return {
    stateVersions: [],
    stateVersionsLoading: false,
    stateVersionsError: null,
    promoteTargetCache: new Map(),

    loadStateVersions: async (projectStateId: string, environmentId: string) => {
      statesAbort?.abort();
      statesAbort = new AbortController();
      set({ stateVersionsLoading: true, stateVersionsError: null, promoteTargetCache: new Map() });
      try {
        const stateVersions = await api.states.list(projectStateId, environmentId, statesAbort.signal);
        set({ stateVersions, stateVersionsLoading: false });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        set({ stateVersionsError: (err as Error).message, stateVersionsLoading: false });
      }
    },

    preloadPromoteTargets: (psId: string, envIds: string[]) => {
      for (const envId of envIds) {
        api.states.getLatest(psId, envId)
          .then(latest => {
            const cache = new Map(get().promoteTargetCache);
            cache.set(envId, { latest, isFresh: false });
            set({ promoteTargetCache: cache });
          })
          .catch(err => {
            if (err instanceof ApiError && err.status === 404) {
              const cache = new Map(get().promoteTargetCache);
              cache.set(envId, { latest: null, isFresh: true });
              set({ promoteTargetCache: cache });
            }
          });
      }
    },
  };
};

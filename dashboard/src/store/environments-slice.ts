import type { SliceCreator, EnvironmentsSlice } from './types';
import type { CreateEnvironment } from '@/api/types';
import { api } from '@/lib/api';

export const createEnvironmentsSlice: SliceCreator<EnvironmentsSlice> = (set, _get) => {
  let envAbort: AbortController | null = null;

  return {
    environments: [],
    environmentsLoading: false,
    environmentsError: null,
    selectedEnvironmentId: null,

    loadEnvironments: async (projectId: string) => {
      envAbort?.abort();
      envAbort = new AbortController();
      set({ environmentsLoading: true, environmentsError: null });
      try {
        const environments = await api.environments.list(projectId, envAbort.signal);
        set({
          environments,
          environmentsLoading: false,
          selectedEnvironmentId: environments.length > 0 ? environments[0].environmentId : null,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        set({ environmentsError: (err as Error).message, environmentsLoading: false });
      }
    },

    selectEnvironment: (id: string | null) => {
      set({
        selectedEnvironmentId: id,
        stateVersionsError: null,
      });
      // State version loading requires projectStateId which is not available from
      // environment selection alone. Components will trigger loadStateVersions
      // explicitly when they have the correct projectStateId.
    },

    createEnvironment: async (projectId: string, body: CreateEnvironment) => {
      const res = await api.environments.create(projectId, body);
      const created = await api.environments.get(projectId, res.environmentId);
      set((s) => ({ environments: [...s.environments, created] }));
      _get().loadBilling();
      return res.environmentId;
    },

    updateEnvironment: async (projectId: string, envId: string, body: { name: string; color: string }) => {
      await api.environments.update(projectId, envId, body);
      const updated = await api.environments.get(projectId, envId);
      set((s) => ({
        environments: s.environments.map(e => e.environmentId === envId ? updated : e),
      }));
    },

    deleteEnvironment: async (projectId: string, envId: string) => {
      await api.environments.delete(projectId, envId);
      const state = _get();
      const remaining = state.environments.filter(e => e.environmentId !== envId);
      const wasSelected = state.selectedEnvironmentId === envId;
      set({
        environments: remaining,
        ...(wasSelected ? {
          selectedEnvironmentId: remaining.length > 0 ? remaining[0].environmentId : null,
          stateVersions: [],
          stateVersionsLoading: false,
          stateVersionsError: null,
        } : {}),
      });
      _get().loadBilling();
    },
  };
};

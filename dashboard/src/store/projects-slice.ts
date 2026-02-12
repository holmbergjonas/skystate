import type { SliceCreator, ProjectsSlice } from './types';
import type { CreateProject, UpdateProject } from '@/api/types';
import { api } from '@/lib/api';

export const createProjectsSlice: SliceCreator<ProjectsSlice> = (set, get) => ({
  projects: [],
  projectsLoading: false,
  projectsError: null,
  selectedProjectId: null,

  loadProjects: async () => {
    set({ projectsLoading: true, projectsError: null });
    try {
      const projects = await api.projects.list();
      set({ projects, projectsLoading: false });
    } catch (err) {
      set({ projectsError: (err as Error).message, projectsLoading: false });
    }
  },

  selectProject: (id: string | null) => {
    set({
      selectedProjectId: id,
      environments: [],
      environmentsLoading: false,
      environmentsError: null,
      selectedEnvironmentId: null,
      stateVersions: [],
      stateVersionsLoading: false,
      stateVersionsError: null,
    });
    if (id) get().loadEnvironments(id);
  },

  createProject: async (body: CreateProject) => {
    const result = await api.projects.create(body);
    await get().loadProjects();
    get().loadBilling();
    return result.projectId;
  },

  updateProject: async (id: string, body: UpdateProject) => {
    await api.projects.update(id, body);
    await get().loadProjects();
  },

  deleteProject: async (id: string) => {
    await api.projects.delete(id);
    // Atomically remove from list and clear selection to prevent
    // auto-select from picking the deleted project from stale array
    const wasSelected = get().selectedProjectId === id;
    set({
      projects: get().projects.filter(p => p.projectId !== id),
      ...(wasSelected ? {
        selectedProjectId: null,
        environments: [],
        environmentsLoading: false,
        environmentsError: null,
        selectedEnvironmentId: null,
        stateVersions: [],
        stateVersionsLoading: false,
        stateVersionsError: null,
      } : {}),
    });
    await get().loadProjects();
    get().loadBilling();
  },
});

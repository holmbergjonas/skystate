import type { StateCreator } from 'zustand';
import type {
  User,
  Project,
  Environment,
  ProjectState,
  BillingStatus,
  Invoice,
  CreateProject,
  UpdateProject,
  CreateEnvironment,
} from '@/api/types';

export interface AuthSlice {
  user: User | null;
  setUser: (user: User | null) => void;
  updateUserRetention: (days: number | null) => Promise<void>;
}

export interface ProjectsSlice {
  projects: Project[];
  projectsLoading: boolean;
  projectsError: string | null;
  selectedProjectId: string | null;
  loadProjects: () => Promise<void>;
  selectProject: (id: string | null) => void;
  createProject: (body: CreateProject) => Promise<string>;
  updateProject: (id: string, body: UpdateProject) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}

export interface EnvironmentsSlice {
  environments: Environment[];
  environmentsLoading: boolean;
  environmentsError: string | null;
  selectedEnvironmentId: string | null;
  loadEnvironments: (projectId: string) => Promise<void>;
  selectEnvironment: (id: string | null) => void;
  createEnvironment: (projectId: string, body: CreateEnvironment) => Promise<string>;
  updateEnvironment: (projectId: string, envId: string, body: { name: string; color: string }) => Promise<void>;
  deleteEnvironment: (projectId: string, envId: string) => Promise<void>;
}

export interface PromoteTargetEntry {
  latest: ProjectState | null;
  isFresh: boolean;
}

export interface StatesSlice {
  stateVersions: ProjectState[];
  stateVersionsLoading: boolean;
  stateVersionsError: string | null;
  promoteTargetCache: Map<string, PromoteTargetEntry>;
  loadStateVersions: (projectStateId: string, environmentId: string) => Promise<void>;
  preloadPromoteTargets: (psId: string, envIds: string[]) => void;
}

export interface BillingSlice {
  billing: BillingStatus | null;
  billingLoading: boolean;
  billingError: string | null;
  loadBilling: () => Promise<void>;
  invoices: Invoice[];
  invoicesLoading: boolean;
  invoicesError: string | null;
  loadInvoices: () => Promise<void>;
}

import type { StateTabSlice } from './state-tab-slice';

export type StoreState = AuthSlice & ProjectsSlice & EnvironmentsSlice & StatesSlice & BillingSlice & StateTabSlice;

export type SliceCreator<T> = StateCreator<StoreState, [], [], T>;

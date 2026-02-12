import type {
  User,
  Project,
  Environment,
  ProjectState,
  BillingStatus,
  Invoice,
  CreateProject,
  CreateProjectResponse,
  UpdateProject,
  CreateEnvironment,
  CreateEnvironmentResponse,
  UpdateEnvironment,
  CreateProjectState,
  CreateProjectStateResponse,
  CheckoutRequest,
  PortalRequest,
  BoostCheckoutRequest,
  BoostUpdateRequest,
  ChangeTierRequest,
  UpdateRetentionRequest,
  UrlResponse,
} from '@/api/types';
import { getAuthHeaders, clearToken } from '@/lib/auth';
import { env } from '@/lib/env';
import { ApiError } from '@/lib/api-error';
import { setApiAvailable } from '@/lib/api-status';

const BASE = env.VITE_API_BASE_URL;

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...(options.headers as Record<string, string> ?? {}),
      },
      signal: options.signal,
    });
  } catch (error: unknown) {
    // AbortError = intentional cancellation, not a connectivity issue
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    // TypeError = network failure (DNS, refused, offline, CORS preflight)
    setApiAvailable(false);
    throw error;
  }

  // Successful response means API is reachable (4xx/5xx are app errors, not connectivity)
  setApiAvailable(true);

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new ApiError(401, 'Unauthorized', null);
  }

  if (!res.ok) {
    let errorBody = null;
    try {
      errorBody = await res.json();
    } catch {
      // Non-JSON error response (e.g., plain text stack trace from .NET)
    }
    throw new ApiError(res.status, res.statusText, errorBody);
  }

  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export const api = {
  users: {
    getCurrent: () =>
      request<User>('/users/me'),
    updateRetention: (body: UpdateRetentionRequest) =>
      request<void>('/users/me/retention', { method: 'PUT', body: JSON.stringify(body) }),
  },

  projects: {
    list: () =>
      request<Project[]>('/projects'),
    create: (body: CreateProject) =>
      request<CreateProjectResponse>('/projects', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: UpdateProject) =>
      request<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) =>
      request<void>(`/projects/${id}`, { method: 'DELETE' }),
  },

  environments: {
    list: (projectId: string, signal?: AbortSignal) =>
      request<Environment[]>(`/projects/${projectId}/environments`, { signal }),
    get: (projectId: string, envId: string) =>
      request<Environment>(`/projects/${projectId}/environments/${envId}`),
    create: (projectId: string, body: CreateEnvironment) =>
      request<CreateEnvironmentResponse>(`/projects/${projectId}/environments`, { method: 'POST', body: JSON.stringify(body) }),
    update: (projectId: string, envId: string, body: UpdateEnvironment) =>
      request<Environment>(`/projects/${projectId}/environments/${envId}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (projectId: string, envId: string) =>
      request<void>(`/projects/${projectId}/environments/${envId}`, { method: 'DELETE' }),
  },

  states: {
    list: (psId: string, envId: string, signal?: AbortSignal) =>
      request<ProjectState[]>(`/projectstates/${psId}/environment/${envId}`, { signal }),
    create: (psId: string, envId: string, body: CreateProjectState) =>
      request<CreateProjectStateResponse>(`/projectstates/${psId}/environment/${envId}`, { method: 'POST', body: JSON.stringify(body) }),
    getLatest: (psId: string, envId: string) =>
      request<ProjectState>(`/projectstates/${psId}/environment/${envId}/latest`),
    rollback: (psId: string, envId: string, targetPsId: string) =>
      request<void>(`/projectstates/${psId}/environment/${envId}/rollback/${targetPsId}`, { method: 'POST' }),
  },

  billing: {
    status: () =>
      request<BillingStatus>('/billing/status'),
    checkout: (body: CheckoutRequest) =>
      request<UrlResponse>('/billing/checkout', { method: 'POST', body: JSON.stringify(body) }),
    portal: (body: PortalRequest) =>
      request<UrlResponse>('/billing/portal', { method: 'POST', body: JSON.stringify(body) }),
    boostCheckout: (body: BoostCheckoutRequest) =>
      request<UrlResponse>('/billing/boost/checkout', { method: 'POST', body: JSON.stringify(body) }),
    boostUpdate: (body: BoostUpdateRequest) =>
      request<{ message: string }>('/billing/boost', { method: 'PUT', body: JSON.stringify(body) }),
    changeTier: (body: ChangeTierRequest) =>
      request<{ message: string }>('/billing/change-tier', { method: 'POST', body: JSON.stringify(body) }),
  },

  invoices: {
    list: () =>
      request<Invoice[]>('/invoices'),
  },
};

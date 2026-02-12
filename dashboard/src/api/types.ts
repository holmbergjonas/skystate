// ============================================================
// SkyState API Types
// Mirrors: SkyState.Api/Endpoints/*.cs + SkyState.Api/Models/*.cs
// Updated manually to match BillingStatusResponse changes (Phases 2-4)
// ============================================================

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface User {
  userId: string;
  ssoProvider: string;
  ssoUserId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  stripeUserId: string | null;
  customRetentionDays: number | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  projectId: string;
  userId: string;
  name: string;
  slug: string;
  apiKeyHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  environmentId: string;
  projectId: string;
  name: string;
  slug: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectState {
  projectStateId: string;
  environmentId: string;
  major: number;
  minor: number;
  patch: number;
  state: string;
  comment: string | null;
  createdAt: string;
  stateSizeBytes: number;
  version: Version;
}

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export interface ResourceUsage {
  count: number;
  limit: number | null; // null = unlimited
}

export interface StorageUsage {
  bytes: number;
  limit: number | null; // null = unlimited
}

export interface ApiRequestUsage {
  count: number;
  limit: number | null; // null = unlimited
  resetDate: string; // ISO 8601
}

export interface Invoice {
  invoiceId: string;
  userId: string;
  tier: string;
  boostMultiplier: number;
  amountPaidCents: number;
  status: 'pending' | 'paid' | 'void' | 'failed';
  billingPeriodStart: string;
  billingPeriodEnd: string;
  createdAt: string;
}

export interface BillingStatus {
  tier: string;
  boostMultiplier: number;
  projects: ResourceUsage;
  environments: ResourceUsage;
  storage: StorageUsage;

  retentionDays: number | null;
  customRetentionDays: number | null;
  currentPeriodEnd: string | null;
  overLimit: string[];
  apiRequests: ApiRequestUsage;
  lastStripeError: string | null;
}

// ---------------------------------------------------------------------------
// Request types (for POST/PUT bodies)
// ---------------------------------------------------------------------------

export interface CreateProject {
  name: string;
  slug: string;
  apiKeyHash: string;
}

export interface UpdateProject {
  name: string;
  apiKeyHash: string;
}

export interface CreateEnvironment {
  name: string;
  slug: string;
  color?: string;
}

export interface UpdateEnvironment {
  name: string;
  color: string;
}

export interface CreateProjectState {
  major: number;
  minor: number;
  patch: number;
  state: string;
  comment?: string | null;
}

export interface CheckoutRequest {
  tier: string;
  successUrl: string;
  cancelUrl: string;
}

export interface BoostCheckoutRequest {
  quantity: number;
  successUrl: string;
  cancelUrl: string;
}

export interface UpdateRetentionRequest {
  days: number | null;
}

export interface BoostUpdateRequest {
  quantity: number;
}

export interface ChangeTierRequest {
  tier: string;
}

export interface PortalRequest {
  returnUrl: string;
}

// ---------------------------------------------------------------------------
// API response wrappers for create operations
// ---------------------------------------------------------------------------

export interface CreateProjectResponse {
  projectId: string;
}

export interface CreateEnvironmentResponse {
  environmentId: string;
  initialStateId: string;
}

export interface CreateProjectStateResponse {
  projectStateId: string;
}

export interface UrlResponse {
  url: string;
}

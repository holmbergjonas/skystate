import { env } from '@/lib/env';

// Constants
const TOKEN_KEY = 'skystate_token';
const SIGNED_OUT_KEY = 'skystate_signed_out';
const AUTH_ENDPOINT = env.VITE_API_BASE_URL + '/auth/github';

// Token CRUD (AUTH-03)

function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

// OAuth Flow (AUTH-02)

export function redirectToLogin(): void {
  window.location.href = AUTH_ENDPOINT;
}

export function extractTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    setToken(token);
    window.history.replaceState({}, '', window.location.pathname);
    return token;
  }
  return null;
}

// Token Validation (AUTH-03)

export async function validateToken(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  try {
    const response = await fetch(env.VITE_API_BASE_URL + '/users/me', {
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (response.status === 401) {
      clearToken();
      return false;
    }

    return response.ok;
  } catch {
    return false;
  }
}

// Auth Headers (AUTH-02, AUTH-06)

export function getAuthHeaders(): Record<string, string> {
  if (env.VITE_TEST_MODE) {
    const headers: Record<string, string> = {};
    if (env.VITE_TEST_GITHUB_ID) headers['X-Test-GitHub-Id'] = env.VITE_TEST_GITHUB_ID;
    if (env.VITE_TEST_EMAIL) headers['X-Test-Email'] = env.VITE_TEST_EMAIL;
    if (env.VITE_TEST_NAME) headers['X-Test-Name'] = env.VITE_TEST_NAME;
    return headers;
  }

  const token = getToken();
  if (token) {
    return { 'Authorization': 'Bearer ' + token };
  }
  return {};
}

export function isTestMode(): boolean {
  return env.VITE_TEST_MODE;
}

// Sign Out (AUTH-05)

export function signOut(): void {
  clearToken();
  sessionStorage.setItem(SIGNED_OUT_KEY, 'true');
}

export function clearSignedOut(): void {
  sessionStorage.removeItem(SIGNED_OUT_KEY);
}

export function isSignedOut(): boolean {
  return sessionStorage.getItem(SIGNED_OUT_KEY) === 'true';
}

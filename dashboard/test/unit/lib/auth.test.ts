import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @/lib/env before importing auth
vi.mock('@/lib/env', () => ({
  env: {
    VITE_API_BASE_URL: 'http://localhost:5148',
    VITE_TEST_MODE: false,
    VITE_TEST_GITHUB_ID: undefined,
    VITE_TEST_EMAIL: undefined,
    VITE_TEST_NAME: undefined,
  },
}));

import {
  clearToken,
  isAuthenticated,
  extractTokenFromUrl,
  getAuthHeaders,
  signOut,
  isSignedOut,
  clearSignedOut,
  isTestMode,
  validateToken,
  redirectToLogin,
} from '@/lib/auth';

// Access the mocked env for mutation in tests
import { env } from '@/lib/env';

describe('auth', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // Reset env mock to defaults
    (env as Record<string, unknown>).VITE_TEST_MODE = false;
    (env as Record<string, unknown>).VITE_TEST_GITHUB_ID = undefined;
    (env as Record<string, unknown>).VITE_TEST_EMAIL = undefined;
    (env as Record<string, unknown>).VITE_TEST_NAME = undefined;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAuthenticated', () => {
    it('returns false when no token is stored', () => {
      expect(isAuthenticated()).toBe(false);
    });

    it('returns true after token is set via extractTokenFromUrl', () => {
      // Simulate URL with token
      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          search: '?token=test-token-123',
          pathname: '/dashboard',
          href: 'http://localhost/dashboard?token=test-token-123',
        },
        writable: true,
      });
      vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

      extractTokenFromUrl();
      expect(isAuthenticated()).toBe(true);
    });
  });

  describe('clearToken', () => {
    it('removes token and makes isAuthenticated false', () => {
      sessionStorage.setItem('skystate_token', 'abc');
      expect(isAuthenticated()).toBe(true);
      clearToken();
      expect(isAuthenticated()).toBe(false);
    });
  });

  describe('extractTokenFromUrl', () => {
    it('returns token and stores it when URL has token param', () => {
      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          search: '?token=my-jwt-token',
          pathname: '/app',
          href: 'http://localhost/app?token=my-jwt-token',
        },
        writable: true,
      });
      vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

      const result = extractTokenFromUrl();
      expect(result).toBe('my-jwt-token');
      expect(sessionStorage.getItem('skystate_token')).toBe('my-jwt-token');
    });

    it('returns null when no token param in URL', () => {
      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          search: '',
          pathname: '/',
          href: 'http://localhost/',
        },
        writable: true,
      });

      const result = extractTokenFromUrl();
      expect(result).toBeNull();
    });

    it('cleans up URL after extracting token', () => {
      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          search: '?token=abc',
          pathname: '/path',
          href: 'http://localhost/path?token=abc',
        },
        writable: true,
      });
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

      extractTokenFromUrl();
      expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/path');
    });
  });

  describe('getAuthHeaders', () => {
    it('returns test headers in test mode', () => {
      (env as Record<string, unknown>).VITE_TEST_MODE = true;
      (env as Record<string, unknown>).VITE_TEST_GITHUB_ID = 'gh-123';
      (env as Record<string, unknown>).VITE_TEST_EMAIL = 'test@example.com';
      (env as Record<string, unknown>).VITE_TEST_NAME = 'Test User';

      const headers = getAuthHeaders();
      expect(headers['X-Test-GitHub-Id']).toBe('gh-123');
      expect(headers['X-Test-Email']).toBe('test@example.com');
      expect(headers['X-Test-Name']).toBe('Test User');
    });

    it('returns Authorization Bearer header when token exists', () => {
      sessionStorage.setItem('skystate_token', 'bearer-token');
      const headers = getAuthHeaders();
      expect(headers['Authorization']).toBe('Bearer bearer-token');
    });

    it('returns empty object when no token and not test mode', () => {
      const headers = getAuthHeaders();
      expect(headers).toEqual({});
    });
  });

  describe('signOut', () => {
    it('clears token and sets signed out flag', () => {
      sessionStorage.setItem('skystate_token', 'abc');
      signOut();
      expect(isAuthenticated()).toBe(false);
      expect(isSignedOut()).toBe(true);
    });
  });

  describe('isSignedOut / clearSignedOut', () => {
    it('returns false by default', () => {
      expect(isSignedOut()).toBe(false);
    });

    it('returns true after signOut', () => {
      signOut();
      expect(isSignedOut()).toBe(true);
    });

    it('returns false after clearSignedOut', () => {
      signOut();
      clearSignedOut();
      expect(isSignedOut()).toBe(false);
    });
  });

  describe('isTestMode', () => {
    it('returns false when VITE_TEST_MODE is false', () => {
      expect(isTestMode()).toBe(false);
    });

    it('returns true when VITE_TEST_MODE is true', () => {
      (env as Record<string, unknown>).VITE_TEST_MODE = true;
      expect(isTestMode()).toBe(true);
    });
  });

  describe('validateToken', () => {
    it('returns false when no token is stored', async () => {
      const result = await validateToken();
      expect(result).toBe(false);
    });

    it('returns true for valid token (200 OK)', async () => {
      sessionStorage.setItem('skystate_token', 'valid-token');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const result = await validateToken();
      expect(result).toBe(true);
    });

    it('returns false and clears token on 401', async () => {
      sessionStorage.setItem('skystate_token', 'expired-token');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

      const result = await validateToken();
      expect(result).toBe(false);
      expect(isAuthenticated()).toBe(false);
    });

    it('returns false on network error', async () => {
      sessionStorage.setItem('skystate_token', 'some-token');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await validateToken();
      expect(result).toBe(false);
    });
  });

  describe('redirectToLogin', () => {
    it('sets window.location.href to auth endpoint', () => {
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
      });

      redirectToLogin();
      expect(window.location.href).toBe('http://localhost:5148/auth/github');
    });
  });
});

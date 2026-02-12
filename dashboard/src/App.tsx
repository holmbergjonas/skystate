import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router';
import { LoginPage } from '@/features/login/LoginPage';
import { AppShell } from '@/layout/AppShell';
import { isAuthenticated, extractTokenFromUrl, validateToken, isTestMode, isSignedOut } from '@/lib/auth';
import { ServiceBanner } from '@/components/ServiceBanner';

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkAuth() {
      // 1. Try extracting token from OAuth callback URL (?token=...)
      const callbackToken = extractTokenFromUrl();

      if (callbackToken) {
        // Token found in URL -- validate it
        const valid = await validateToken();
        setAuthed(valid);
        setAuthChecked(true);
        if (valid) {
          navigate('/', { replace: true });
        }
        return;
      }

      // 2. Check test mode -- auto-authenticate (unless user explicitly signed out)
      if (isTestMode() && !isSignedOut()) {
        setAuthed(true);
        setAuthChecked(true);
        return;
      }

      // 3. Check existing sessionStorage token
      if (isAuthenticated()) {
        const valid = await validateToken();
        setAuthed(valid);
      }

      setAuthChecked(true);
    }

    checkAuth();
  }, [navigate]); // Run once on mount — navigate is stable

  // Show nothing while checking auth (prevents flash of login page)
  if (!authChecked) {
    return null;
  }

  return (
    <>
      <ServiceBanner />
      <Routes>
        <Route
          path="/login"
          element={authed ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/*"
          element={authed ? <AppShell /> : <Navigate to="/login" replace />}
        />
      </Routes>
    </>
  );
}

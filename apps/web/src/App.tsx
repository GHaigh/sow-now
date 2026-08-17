import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OnboardingPage } from './pages/Onboarding';
import { DashboardPage } from './pages/Dashboard';
import { AdvicePage } from './pages/Advice';
import { CropsPage } from './pages/Crops';
import { SensorsPage } from './pages/Sensors';
import { SettingsPage } from './pages/Settings';
import { BillingSuccessPage } from './pages/BillingSuccess';
import { LoginPage } from './pages/Login';
import { SetupGuidePage } from './pages/SetupGuide';
import { AppShell } from './components/AppShell';
import { API_BASE } from './lib/api';

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.deviceProvisioned) return <Navigate to="/setup" replace />;
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/advice" element={<AdvicePage />} />
        <Route path="/crops" element={<CropsPage />} />
        <Route path="/sensors" element={<SensorsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/billing/success" element={<BillingSuccessPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

// Handles both:
//   ?token=XXX  — magic link query param, calls API to exchange for session
//   #session=XXX — session hash set by API redirect
function SessionCapture() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    // Case 1: API redirected with #session=TOKEN in hash
    const hash = window.location.hash;
    if (hash.startsWith('#session=')) {
      const token = hash.slice(9);
      localStorage.setItem('session_token', token);
      window.location.hash = '';
      navigate('/', { replace: true });
      window.location.reload();
      return;
    }

    // Case 2: Magic link ?token=XXX query param — call API to verify
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setVerifying(true);
      fetch(`${API_BASE}/api/v1/auth/verify?token=${token}`)
        .then(async res => {
          if (!res.ok) {
            setError('Sign-in link has expired or already been used.');
            return;
          }
          const { sessionToken } = await res.json() as { sessionToken: string };
          localStorage.setItem('session_token', sessionToken);
          navigate('/', { replace: true });
          window.location.reload();
        })
        .catch(() => setError('Something went wrong. Please try again.'))
        .finally(() => setVerifying(false));
    }
  }, [navigate]);

  if (error) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '24px',
        background: '#f9fafb',
      }}>
        <div style={{ fontSize: '36px' }}>🌱</div>
        <p style={{ color: '#dc2626', fontSize: '15px', textAlign: 'center', maxWidth: '320px' }}>{error}</p>
        <a href="/login" style={{ color: '#166534', fontWeight: 600, fontSize: '15px' }}>Back to sign in</a>
      </div>
    );
  }

  // Only show splash while actively verifying a token
  if (verifying) return <SplashScreen />;

  return null;
}

function SplashScreen() {
  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#166534',
      gap: '16px',
    }}>
      <div style={{ fontSize: '48px' }}>🌱</div>
      <div style={{ color: '#fff', fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px' }}>Sow Now</div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <SessionCapture />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/guide" element={<SetupGuidePage />} />
          <Route path="/auth/verify" element={<SessionCapture />} />
          <Route path="/setup/*" element={<OnboardingPage />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

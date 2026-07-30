import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OnboardingPage } from './pages/Onboarding';
import { DashboardPage } from './pages/Dashboard';
import { AdvicePage } from './pages/Advice';
import { CropsPage } from './pages/Crops';
import { SensorsPage } from './pages/Sensors';
import { SettingsPage } from './pages/Settings';
import { LoginPage } from './pages/Login';
import { AppShell } from './components/AppShell';

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

// Handles the #session=TOKEN redirect from the magic link verify endpoint
function SessionCapture() {
  const navigate = useNavigate();
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#session=')) {
      const token = hash.slice(9);
      localStorage.setItem('session_token', token);
      window.location.hash = '';
      navigate('/', { replace: true });
      window.location.reload();
    }
  }, [navigate]);
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
          <Route path="/auth/verify" element={<SessionCapture />} />
          <Route path="/setup/*" element={<OnboardingPage />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

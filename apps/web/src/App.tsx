import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OnboardingPage } from './pages/Onboarding';
import { DashboardPage } from './pages/Dashboard';
import { AdvicePage } from './pages/Advice';
import { CropsPage } from './pages/Crops';
import { SensorsPage } from './pages/Sensors';
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
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
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup/*" element={<OnboardingPage />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

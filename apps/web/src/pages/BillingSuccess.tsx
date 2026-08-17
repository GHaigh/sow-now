import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * BillingSuccess
 *
 * Stripe redirects here after a successful checkout:
 *   /billing/success?session_id=cs_xxx
 *
 * We just show a confirmation message and redirect to Settings
 * after a short delay so the user sees the success state.
 */
export function BillingSuccessPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => navigate('/settings', { replace: true }), 3500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '20px',
      padding: '24px',
      background: '#f7f8fa',
    }}>
      <div style={{ fontSize: '56px' }}>🎉</div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px', textAlign: 'center' }}>
        You're subscribed!
      </h1>
      <p style={{ fontSize: '0.95rem', color: '#57606a', textAlign: 'center', maxWidth: '320px', lineHeight: 1.6 }}>
        Your Sow Now plan is now active. Daily AI advice, full GDD history, and everything else is unlocked.
      </p>
      <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Taking you to settings…</p>
    </div>
  );
}

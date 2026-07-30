import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import styles from './Settings.module.css';

interface BillingStatus {
  tier: string;
  tier_expires_at: number | null;
  has_payment_method: boolean;
}

const TIER_LABELS: Record<string, string> = {
  seed:        'Seed (Free)',
  grower:      'Grower — £4.99/mo',
  smallholder: 'Smallholder — £12.99/mo',
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  seed:        'Dashboard, 7-day history, basic GDD tracking',
  grower:      'Full GDD history, daily AI advice, crop tracking for up to 8 beds',
  smallholder: 'Everything in Grower + unlimited beds, CSV export, priority support',
};

export function SettingsPage() {
  const { user } = useAuth();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<BillingStatus>('/api/v1/billing/status')
      .then(setBilling)
      .catch(() => setError('Unable to load billing status'))
      .finally(() => setLoading(false));
  }, []);

  async function upgrade(tier: 'grower' | 'smallholder') {
    setUpgrading(tier);
    setError(null);
    try {
      const res = await apiFetch<{ url: string }>('/api/v1/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ tier }),
      });
      window.location.href = res.url;
    } catch {
      setError('Failed to start checkout. Please try again.');
    } finally {
      setUpgrading(null);
    }
  }

  async function manageSubscription() {
    setError(null);
    try {
      const res = await apiFetch<{ url: string }>('/api/v1/billing/portal', {
        method: 'POST',
      });
      window.location.href = res.url;
    } catch {
      setError('Failed to open billing portal. Please try again.');
    }
  }

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>

      {/* Account */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Account</h2>
        <div className={styles.row}>
          <span className={styles.label}>Email</span>
          <span className={styles.value}>{user?.email}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Plan</span>
          <span className={styles.value}>
            <span className={`${styles.badge} ${styles[`badge_${billing?.tier ?? 'seed'}`]}`}>
              {TIER_LABELS[billing?.tier ?? 'seed']}
            </span>
          </span>
        </div>
        {billing?.tier_expires_at && (
          <div className={styles.row}>
            <span className={styles.label}>Renews</span>
            <span className={styles.value}>
              {new Date(billing.tier_expires_at * 1000).toLocaleDateString('en-GB')}
            </span>
          </div>
        )}
      </section>

      {/* Plan cards */}
      {billing?.tier === 'seed' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Upgrade your plan</h2>
          <div className={styles.planGrid}>
            {(['grower', 'smallholder'] as const).map(tier => (
              <div key={tier} className={styles.planCard}>
                <div className={styles.planName}>{TIER_LABELS[tier]}</div>
                <div className={styles.planDesc}>{TIER_DESCRIPTIONS[tier]}</div>
                <button
                  className={styles.upgradeBtn}
                  disabled={upgrading === tier}
                  onClick={() => upgrade(tier)}
                >
                  {upgrading === tier ? 'Redirecting…' : 'Upgrade'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Manage subscription */}
      {billing?.tier !== 'seed' && (
        <section className={styles.section}>
          <button className={styles.manageBtn} onClick={manageSubscription}>
            Manage subscription
          </button>
          <p className={styles.hint}>Update payment method, change plan, or cancel.</p>
        </section>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {/* Sign out */}
      <section className={styles.section}>
        <button
          className={styles.signOutBtn}
          onClick={async () => {
            await apiFetch('/api/v1/auth/logout', { method: 'POST' });
            localStorage.removeItem('session_token');
            window.location.href = '/login';
          }}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}

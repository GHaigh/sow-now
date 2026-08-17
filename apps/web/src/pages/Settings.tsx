import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, subscribePush, unsubscribePush, VAPID_PUBLIC_KEY } from '../lib/api';
import styles from './Settings.module.css';

interface BillingStatus {
  tier: string;
  tier_expires_at: number | null;
  has_payment_method: boolean;
}

interface MeProfile {
  postcode_prefix: string | null;
  climate_zone: string | null;
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

const ZONE_LABELS: Record<string, string> = {
  'uk-south':    'South England',
  'uk-midlands': 'Midlands / East',
  'uk-north':    'North England / Wales',
  'uk-scotland': 'Scotland / Northern Ireland',
};

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

export function SettingsPage() {
  const { user } = useAuth();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [profile, setProfile] = useState<MeProfile>({ postcode_prefix: null, climate_zone: null });
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Location form state
  const [postcode, setPostcode] = useState('');
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationSuccess, setLocationSuccess] = useState(false);

  // Push notifications state
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    // Check push support
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setPushSupported(true);
      navigator.serviceWorker.ready.then(reg => {
        reg.pushManager.getSubscription().then(sub => {
          setPushEnabled(sub != null);
        });
      });
    }

    Promise.all([
      apiFetch<BillingStatus>('/api/v1/billing/status'),
      apiFetch<MeProfile & { push_enabled: boolean }>('/api/v1/me'),
    ])
      .then(([b, me]) => {
        setBilling(b);
        setProfile(me);
        if (me.postcode_prefix) setPostcode(me.postcode_prefix);
        if (me.push_enabled) setPushEnabled(true);
      })
      .catch(() => setError('Unable to load account details'))
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

  async function saveLocation() {
    const trimmed = postcode.trim().toUpperCase();
    if (!trimmed) return;
    setLocationSaving(true);
    setLocationSuccess(false);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; postcode: string; zone: string }>(
        '/api/v1/me/location',
        { method: 'PATCH', body: JSON.stringify({ postcode: trimmed }) },
      );
      setProfile({ postcode_prefix: res.postcode, climate_zone: res.zone });
      setLocationSuccess(true);
    } catch {
      setError('Failed to save location. Please try again.');
    } finally {
      setLocationSaving(false);
    }
  }

  async function togglePush() {
    setPushLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushEnabled) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
        await unsubscribePush();
        setPushEnabled(false);
      } else {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY),
        });
        await subscribePush(sub.toJSON() as PushSubscriptionJSON);
        setPushEnabled(true);
      }
    } catch {
      setError('Failed to update notification settings.');
    } finally {
      setPushLoading(false);
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

      {/* Notifications */}
      {pushSupported && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Notifications</h2>
          <div className={styles.row}>
            <div>
              <span className={styles.label} style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                Daily growing advice
              </span>
              <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: 2 }}>
                Morning push notification with your daily AI advice
              </p>
            </div>
            <button
              onClick={togglePush}
              disabled={pushLoading}
              style={{
                flexShrink: 0,
                background: pushEnabled ? '#166534' : '#e5e7eb',
                color: pushEnabled ? '#fff' : '#6b7280',
                border: 'none',
                borderRadius: 99,
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: pushLoading ? 0.6 : 1,
              }}
            >
              {pushLoading ? '…' : pushEnabled ? 'On' : 'Off'}
            </button>
          </div>
        </section>
      )}

      {/* Location */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Location</h2>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: 12, lineHeight: 1.5 }}>
          Your postcode prefix (e.g. <strong>NG1</strong>) is used to determine your UK climate zone
          for frost date estimates and variety predictions.
        </p>
        {profile.climate_zone && (
          <div className={styles.row}>
            <span className={styles.label}>Climate zone</span>
            <span className={styles.value}>{ZONE_LABELS[profile.climate_zone] ?? profile.climate_zone}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4 }}>
              Postcode prefix
            </label>
            <input
              className="input"
              style={{ padding: '10px 12px', fontSize: '0.95rem' }}
              placeholder={profile.postcode_prefix ?? 'e.g. NG1'}
              value={postcode}
              maxLength={4}
              onChange={e => { setPostcode(e.target.value.toUpperCase()); setLocationSuccess(false); }}
              onKeyDown={e => { if (e.key === 'Enter') saveLocation(); }}
            />
          </div>
          <button
            style={{
              background: '#166534', color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 16px', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
              flexShrink: 0, opacity: locationSaving ? 0.6 : 1,
            }}
            disabled={locationSaving}
            onClick={saveLocation}
          >
            {locationSaving ? '…' : 'Save'}
          </button>
        </div>
        {locationSuccess && (
          <p style={{ fontSize: '12px', color: '#166534', marginTop: 8 }}>✓ Location saved</p>
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

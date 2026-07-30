import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import styles from './OnboardingStep.module.css';

interface Props { onNext: () => void; }

export function StepScanQR({ onNext }: Props) {
  const [token, setToken]   = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleProvision = async () => {
    if (!token.trim()) return;
    setError('');
    setLoading(true);
    try {
      await apiFetch('/api/v1/provision', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim() }),
      });
      setSuccess(true);
      setTimeout(onNext, 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not connect hub. Check the token and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>📦</div>
        <h1>Connect your hub</h1>
        <p>Find the QR code card inside your Sow Now box and scan it, or type the code printed below it.</p>
      </div>

      <div className="card stack-12" style={{ marginTop: 24 }}>
        <label className={styles.label}>Hub code</label>
        <input
          className="input"
          placeholder="e.g. SN-A1B2C3D4"
          value={token}
          onChange={e => setToken(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect="off"
        />
        {error && <p className="text-red" style={{ fontSize: '0.85rem' }}>{error}</p>}
        {success && <p className="text-green" style={{ fontSize: '0.85rem' }}>✅ Hub connected!</p>}
        <button
          className="btn btn-primary"
          onClick={handleProvision}
          disabled={loading || !token.trim() || success}
        >
          {loading ? 'Connecting…' : 'Connect hub'}
        </button>
      </div>

      <div className={styles.hint}>
        <p>The code is also printed on the bottom of the white hub box.</p>
      </div>
    </div>
  );
}

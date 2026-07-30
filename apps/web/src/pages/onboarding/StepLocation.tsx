import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import styles from './OnboardingStep.module.css';

interface Props { onNext: () => void; }

export function StepLocation({ onNext }: Props) {
  const [postcode, setPostcode] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const handleNext = async () => {
    if (!postcode.trim()) { onNext(); return; }
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/v1/me/location', {
        method: 'PATCH',
        body: JSON.stringify({ postcode: postcode.trim().toUpperCase() }),
      });
      onNext();
    } catch {
      setError('Could not save location. You can set this later in Settings.');
      setTimeout(onNext, 1500);
    } finally { setSaving(false); }
  };

  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>📍</div>
        <h1>Where is your garden?</h1>
        <p>Your postcode tells us your UK climate zone so we can give accurate frost risk and season-start advice.</p>
      </div>

      <div className="card stack-12" style={{ marginTop: 24 }}>
        <label className={styles.label}>Postcode (first part only)</label>
        <input
          className="input"
          placeholder="e.g. SW4, NG1, EX10"
          value={postcode}
          onChange={e => setPostcode(e.target.value)}
          autoCapitalize="characters"
          maxLength={4}
        />
        <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
          We only store the postcode prefix — never your full address.
        </p>
        {error && <p className="text-amber" style={{ fontSize: '0.85rem' }}>{error}</p>}
      </div>

      <div className={styles.hint}>
        <p>🔒 Your location is used only to determine your UK climate zone. It is never shared.</p>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 24 }} className="stack-10">
        <button className="btn btn-primary" onClick={handleNext} disabled={saving}>
          {saving ? 'Saving…' : 'Finish setup →'}
        </button>
        <button className="btn btn-ghost" onClick={onNext} disabled={saving}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

/**
 * StepNameSensors — lets the customer rename each claimed sensor
 * after the scan/claim step in onboarding.
 *
 * Loads the current sensors list, shows an input for each one,
 * and saves names via PATCH /api/v1/sensors/:id.
 */

import { useState, useEffect } from 'react';
import { apiFetch, renameSensor } from '../../lib/api';
import styles from './OnboardingStep.module.css';

interface Sensor {
  id: string;
  sensor_type: string;
  name: string;
}

interface Props {
  onNext: () => void;
}

const TYPE_ICON: Record<string, string> = {
  weather_station: '🌤',
  soil:            '💧',
  greenhouse:      '🏡',
  indoor:          '🌡',
};

const TYPE_PLACEHOLDER: Record<string, string> = {
  weather_station: 'e.g. Garden',
  soil:            'e.g. Raised bed 1',
  greenhouse:      'e.g. Greenhouse',
  indoor:          'e.g. Propagator',
};

export function StepNameSensors({ onNext }: Props) {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ sensors: Sensor[] }>('/api/v1/sensors')
      .then(d => {
        setSensors(d.sensors);
        const initial: Record<string, string> = {};
        for (const s of d.sensors) initial[s.id] = s.name;
        setNames(initial);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        sensors.map(s => {
          const n = names[s.id]?.trim();
          if (n && n !== s.name) return renameSensor(s.id, n);
        }).filter(Boolean)
      );
    } catch { /* non-fatal — can rename later */ }
    finally { setSaving(false); onNext(); }
  };

  if (loading) {
    return (
      <div className={styles.step}>
        <div className={styles.hero}>
          <div className={styles.emoji}>✏️</div>
          <h1>Name your sensors</h1>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 32, marginTop: 20 }}>
          <div className={styles.spinner} />
        </div>
      </div>
    );
  }

  if (sensors.length === 0) {
    return (
      <div className={styles.step}>
        <div className={styles.hero}>
          <div className={styles.emoji}>✏️</div>
          <h1>Name your sensors</h1>
          <p>No sensors found yet — you can name them later from the Sensors page.</p>
        </div>
        <div style={{ marginTop: 'auto', paddingTop: 24 }}>
          <button className="btn btn-primary" onClick={onNext}>Continue →</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>✏️</div>
        <h1>Name your sensors</h1>
        <p>Give each sensor a name that matches where it's placed — this is how your readings will be labelled.</p>
      </div>

      <div className="stack-8" style={{ marginTop: 20 }}>
        {sensors.map(s => (
          <div key={s.id} className="card" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: '1.4rem' }}>{TYPE_ICON[s.sensor_type] ?? '📡'}</span>
              <span style={{ fontSize: '0.78rem', color: '#57606a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {s.sensor_type.replace('_', ' ')}
              </span>
            </div>
            <input
              className="input"
              value={names[s.id] ?? ''}
              onChange={e => setNames(n => ({ ...n, [s.id]: e.target.value }))}
              placeholder={TYPE_PLACEHOLDER[s.sensor_type] ?? 'Sensor name'}
              maxLength={40}
            />
          </div>
        ))}
      </div>

      <div className={styles.hint}>
        <p>💡 You can rename sensors any time from the Sensors page.</p>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save names →'}
        </button>
      </div>
    </div>
  );
}

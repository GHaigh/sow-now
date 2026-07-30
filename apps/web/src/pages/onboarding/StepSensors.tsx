import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import styles from './OnboardingStep.module.css';

interface Sensor { id: string; sensor_type: string; name: string; last_seen_at: number | null; }
interface Props { onNext: () => void; }

export function StepSensors({ onNext }: Props) {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      try {
        const data = await apiFetch<{ sensors: Sensor[] }>('/api/v1/sensors');
        setSensors(data.sensors);
        if (data.sensors.length > 0) setPolling(false);
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [polling]);

  const typeLabel = (t: string) =>
    t === 'weather_station' ? '🌤 Weather station'
    : t === 'soil'          ? '💧 Soil sensor'
    : t === 'greenhouse'    ? '🏡 Greenhouse sensor'
    : '📡 Sensor';

  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>📡</div>
        <h1>Finding your sensors</h1>
        <p>
          {sensors.length === 0
            ? 'Your hub is listening for sensors. This takes up to 30 seconds…'
            : `Found ${sensors.length} sensor${sensors.length > 1 ? 's' : ''}! Check they all appear below.`}
        </p>
      </div>

      <div className="stack-8" style={{ marginTop: 20 }}>
        {sensors.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <div className={styles.spinner} />
            <p style={{ marginTop: 12 }}>Searching…</p>
          </div>
        ) : (
          sensors.map(s => (
            <div key={s.id} className="card row" style={{ gap: 12 }}>
              <span style={{ fontSize: '1.5rem' }}>
                {s.sensor_type === 'weather_station' ? '🌤' : s.sensor_type === 'soil' ? '💧' : '🏡'}
              </span>
              <div className="fill">
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{typeLabel(s.sensor_type)}</div>
                <div style={{ fontSize: '0.8rem', color: '#57606a' }}>ID: {s.id.slice(0, 8)}</div>
              </div>
              <span className="badge badge-green">Found ✓</span>
            </div>
          ))
        )}
      </div>

      {sensors.length === 0 && (
        <div className={styles.hint}>
          <p>Make sure your Ecowitt weather station is powered on and within range.</p>
        </div>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button
          className="btn btn-primary"
          onClick={onNext}
          disabled={sensors.length === 0}
        >
          {sensors.length === 0 ? 'Waiting for sensors…' : `Continue with ${sensors.length} sensor${sensors.length > 1 ? 's' : ''} →`}
        </button>
        {sensors.length === 0 && (
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onNext}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

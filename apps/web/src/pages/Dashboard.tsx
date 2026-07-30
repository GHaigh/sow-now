import { useEffect, useState } from 'react';
import { apiFetch, apiStream } from '../lib/api';
import styles from './Dashboard.module.css';

interface DashboardData {
  device: { name: string; online: boolean; last_seen_at: number | null };
  latest: {
    outdoor: { temp_c: number | null; humidity_pct: number | null; wind_avg_ms: number | null; rain_mm: number | null };
    greenhouse: { temp_c: number | null; humidity_pct: number | null };
    indoor: { temp_c: number | null; humidity_pct: number | null };
    soil: Record<string, { moisture_pct: number | null; temp_c: number | null; battery_pct: number | null }>;
  };
  gdd: { outdoor: number; greenhouse: number; indoor: number; season_start: string };
  gdd_trend: Array<{ date: string; gdd: number; zone: string }>;
  crops: Array<{
    id: string; crop_key: string; display_name: string; bed_name: string | null;
    status: string; gdd_accumulated: number; gdd_to_harvest_min: number | null; gdd_to_harvest_max: number | null;
  }>;
  alerts: string[];
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<DashboardData>('/api/v1/dashboard')
      .then(setData)
      .catch(e => setError((e as Error).message));

    // Live SSE updates
    const stop = apiStream('/api/v1/readings/live', (msg) => {
      setData(prev => prev ? { ...prev, latest: (msg as DashboardData).latest, alerts: (msg as DashboardData).alerts } : prev);
    });
    return stop;
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!data)  return <LoadingState />;

  const { device, latest, gdd, crops, alerts } = data;

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Today</h1>
          <p className={styles.subtitle}>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className={`badge ${device.online ? 'badge-green' : 'badge-red'}`}>
          {device.online ? '● Live' : '○ Offline'}
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className={styles.alerts}>
          {alerts.map(a => <AlertChip key={a} alert={a} />)}
        </div>
      )}

      {/* GDD Summary */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Growing Degree Days</h2>
        <div className={styles.gddCards}>
          <GddCard label="Garden" value={gdd.outdoor} icon="🌤" />
          {gdd.greenhouse > 0 && <GddCard label="Greenhouse" value={gdd.greenhouse} icon="🏡" delta={gdd.greenhouse - gdd.outdoor} />}
          {gdd.indoor > 0 && <GddCard label="Indoors" value={gdd.indoor} icon="🪴" delta={gdd.indoor - gdd.outdoor} />}
        </div>
        {data.gdd_trend.length > 0 && <GddChart trend={data.gdd_trend} />}
      </div>

      {/* Live sensors */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Right now</h2>
        <div className={styles.sensorGrid}>
          {latest.outdoor.temp_c != null && (
            <SensorTile icon="🌡" label="Temp" value={`${latest.outdoor.temp_c.toFixed(1)}°C`} />
          )}
          {latest.outdoor.humidity_pct != null && (
            <SensorTile icon="💧" label="Humidity" value={`${Math.round(latest.outdoor.humidity_pct)}%`} />
          )}
          {latest.outdoor.wind_avg_ms != null && (
            <SensorTile icon="💨" label="Wind" value={`${latest.outdoor.wind_avg_ms.toFixed(1)} m/s`} />
          )}
          {latest.outdoor.rain_mm != null && (
            <SensorTile icon="🌧" label="Rain" value={`${latest.outdoor.rain_mm.toFixed(1)} mm`} />
          )}
          {latest.greenhouse.temp_c != null && (
            <SensorTile icon="🏡" label="Greenhouse" value={`${latest.greenhouse.temp_c.toFixed(1)}°C`} />
          )}
          {latest.indoor.temp_c != null && (
            <SensorTile icon="🪴" label="Indoors" value={`${latest.indoor.temp_c.toFixed(1)}°C`} />
          )}
        </div>

        {/* Soil moisture */}
        {Object.keys(latest.soil).length > 0 && (
          <div className="stack-8" style={{ marginTop: 10 }}>
            {Object.entries(latest.soil).map(([id, s]) => (
              <SoilBar key={id} id={id} moisture={s.moisture_pct} battery={s.battery_pct} />
            ))}
          </div>
        )}
      </div>

      {/* Active crops */}
      {crops.filter(c => c.status !== 'planned').length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Crops in progress</h2>
          <div className="stack-8">
            {crops.filter(c => c.status !== 'planned').map(c => (
              <CropProgress key={c.id} crop={c} />
            ))}
          </div>
        </div>
      )}

      <div style={{ height: 16 }} />
    </div>
  );
}

function GddCard({ label, value, icon, delta }: { label: string; value: number; icon: string; delta?: number }) {
  return (
    <div className={`card ${styles.gddCard}`}>
      <div className={styles.gddIcon}>{icon}</div>
      <div className={styles.gddValue}>{Math.round(value)}</div>
      <div className={styles.gddLabel}>{label} GDD</div>
      {delta != null && delta > 0 && (
        <div className="badge badge-green" style={{ marginTop: 6 }}>+{Math.round(delta)} ahead</div>
      )}
    </div>
  );
}

function GddChart({ trend }: { trend: Array<{ date: string; gdd: number; zone: string }> }) {
  const outdoor = trend.filter(t => t.zone === 'outdoor').slice(-7);
  if (outdoor.length === 0) return null;
  const max = Math.max(...outdoor.map(t => t.gdd), 1);

  return (
    <div className={styles.chart}>
      {outdoor.map(t => (
        <div key={t.date} className={styles.chartCol}>
          <div className={styles.chartBar} style={{ height: `${(t.gdd / max) * 100}%` }} />
          <div className={styles.chartLabel}>{new Date(t.date).toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 1)}</div>
        </div>
      ))}
    </div>
  );
}

function SensorTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className={`card ${styles.sensorTile}`}>
      <div className={styles.sensorIcon}>{icon}</div>
      <div className={styles.sensorValue}>{value}</div>
      <div className={styles.sensorLabel}>{label}</div>
    </div>
  );
}

function SoilBar({ id, moisture, battery }: { id: string; moisture: number | null; battery: number | null }) {
  const pct = moisture ?? 0;
  const color = pct < 30 ? '#dc2626' : pct < 50 ? '#d97706' : '#166534';
  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>💧 {id}</span>
        <div className="row" style={{ gap: 6 }}>
          {moisture != null && <span style={{ fontSize: '0.85rem', fontWeight: 700, color }}>{Math.round(pct)}%</span>}
          {battery != null && battery < 20 && <span className="badge badge-amber">🔋 Low</span>}
        </div>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function CropProgress({ crop }: { crop: DashboardData['crops'][0] }) {
  const max = crop.gdd_to_harvest_max ?? 1000;
  const pct = Math.min((crop.gdd_accumulated / max) * 100, 100);
  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{crop.display_name}</span>
        <span className="badge badge-grey">{crop.bed_name ?? 'Unassigned'}</span>
      </div>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: '0.8rem', color: '#57606a' }}>{Math.round(crop.gdd_accumulated)} / {max} GDD</span>
        <span style={{ fontSize: '0.8rem', color: '#57606a' }}>{Math.round(pct)}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AlertChip({ alert }: { alert: string }) {
  if (alert === 'frost_risk')          return <div className="badge badge-blue">❄️ Frost risk tonight</div>;
  if (alert.startsWith('low_moisture')) return <div className="badge badge-amber">💧 Low soil moisture</div>;
  if (alert.startsWith('low_battery'))  return <div className="badge badge-amber">🔋 Sensor battery low</div>;
  return <div className="badge badge-grey">{alert}</div>;
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60dvh' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🌱</div>
        <p>Loading your garden…</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ padding: 24 }}>
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <p className="text-red">{message}</p>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { apiFetch, apiStream } from '../lib/api';
import styles from './Dashboard.module.css';

interface DashboardData {
  device: { name: string; online: boolean; last_seen_at: number | null };
  latest: {
    outdoor: { temp_c: number | null; humidity_pct: number | null };
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
          {gdd.greenhouse > 0
            ? <GddCard label="Greenhouse" value={gdd.greenhouse} icon="🏡" />
            : <GddCard label="Garden" value={gdd.outdoor} icon="🌱" />}
          {gdd.indoor > 0 && <GddCard label="Indoors" value={gdd.indoor} icon="🪴" />}
        </div>
        {data.gdd_trend.length > 0 && <GddChart trend={data.gdd_trend} />}
      </div>

      {/* Live sensors */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Right now</h2>
        <div className={styles.sensorGrid}>
          {latest.greenhouse.temp_c != null && (
            <SensorTile icon="🏡" label="Greenhouse" value={`${latest.greenhouse.temp_c.toFixed(1)}°C`} />
          )}
          {latest.greenhouse.humidity_pct != null && (
            <SensorTile icon="💧" label="GH Humidity" value={`${Math.round(latest.greenhouse.humidity_pct)}%`} />
          )}
          {latest.indoor.temp_c != null && (
            <SensorTile icon="🪴" label="Indoors" value={`${latest.indoor.temp_c.toFixed(1)}°C`} />
          )}
          {latest.indoor.humidity_pct != null && (
            <SensorTile icon="💧" label="Indoor Hum" value={`${Math.round(latest.indoor.humidity_pct)}%`} />
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

// Colours for each GDD zone bar
const ZONE_COLOR: Record<string, string> = {
  outdoor:    '#166534',
  greenhouse: '#d97706',
  indoor:     '#2563eb',
};

function GddChart({ trend }: { trend: Array<{ date: string; gdd: number; zone: string }> }) {
  // Collect the last 7 distinct dates present in the data
  const dates = [...new Set(trend.map(t => t.date))].sort().slice(-7);
  if (dates.length === 0) return null;

  // Build a lookup: date → { zone → gdd }
  const byDate: Record<string, Record<string, number>> = {};
  for (const row of trend) {
    if (!byDate[row.date]) byDate[row.date] = {};
    byDate[row.date]![row.zone] = row.gdd;
  }

  // Which zones are actually present?
  const zones = (['outdoor', 'greenhouse', 'indoor'] as const).filter(z =>
    trend.some(t => t.zone === z),
  );

  // Scale bars relative to the overall max GDD value
  const allGdd = trend.map(t => t.gdd);
  const max = Math.max(...allGdd, 1);

  return (
    <div>
      <div className={styles.chart}>
        {dates.map(date => (
          <div key={date} className={styles.chartCol}>
            {/* Stack the zone bars for this date */}
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', flex: 1, width: '100%' }}>
              {zones.map(zone => {
                const gdd = byDate[date]?.[zone] ?? 0;
                return (
                  <div
                    key={zone}
                    className={styles.chartBar}
                    style={{
                      flex: 1,
                      height: `${(gdd / max) * 100}%`,
                      background: ZONE_COLOR[zone],
                      opacity: gdd === 0 ? 0.15 : 1,
                    }}
                  />
                );
              })}
            </div>
            <div className={styles.chartLabel}>
              {new Date(date).toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 1)}
            </div>
          </div>
        ))}
      </div>
      {/* Legend — only shown when >1 zone */}
      {zones.length > 1 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
          {zones.map(zone => (
            <div key={zone} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: ZONE_COLOR[zone], flexShrink: 0 }} />
              <span style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'capitalize' }}>
                {zone === 'greenhouse' ? 'Greenhouse' : zone === 'indoor' ? 'Indoors' : 'Garden'}
              </span>
            </div>
          ))}
        </div>
      )}
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

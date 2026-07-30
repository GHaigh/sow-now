import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import styles from './Sensors.module.css';

interface Sensor {
  id: string;
  sensor_type: 'weather_station' | 'soil' | 'greenhouse';
  name: string;
  battery_pct: number | null;
  last_seen_at: number | null;
}

interface DeviceInfo {
  id: string;
  name: string;
  online: boolean;
  last_seen_at: number | null;
  firmware_version: string | null;
}

const TYPE_ICON = { weather_station: '🌤', soil: '💧', greenhouse: '🏡' };
const TYPE_LABEL = { weather_station: 'Weather Station', soil: 'Soil Sensor', greenhouse: 'Greenhouse' };

export function SensorsPage() {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ device: DeviceInfo; sensors: Sensor[] }>('/api/v1/sensors')
      .then(d => { setDevice(d.device); setSensors(d.sensors); })
      .finally(() => setLoading(false));
  }, []);

  const timeSince = (ts: number | null) => {
    if (!ts) return 'Never';
    const mins = Math.round((Date.now() / 1000 - ts) / 60);
    if (mins < 2)  return 'Just now';
    if (mins < 60) return `${mins} mins ago`;
    return `${Math.round(mins / 60)} hrs ago`;
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Sensors</h1>
        <p>{sensors.length} connected</p>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center' }}><p>Loading…</p></div>
      ) : (
        <div style={{ padding: 16 }} className="stack-12">

          {/* Hub status */}
          {device && (
            <div className="card">
              <div className="row-between">
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ fontSize: '1.5rem' }}>📦</span>
                  <div>
                    <div style={{ fontWeight: 700 }}>Sow Now Hub</div>
                    <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                      {device.firmware_version ? `v${device.firmware_version}` : 'Firmware unknown'}
                    </div>
                  </div>
                </div>
                <span className={`badge ${device.online ? 'badge-green' : 'badge-red'}`}>
                  {device.online ? '● Online' : '○ Offline'}
                </span>
              </div>
              {device.last_seen_at && (
                <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 8 }}>
                  Last seen: {timeSince(device.last_seen_at)}
                </p>
              )}
            </div>
          )}

          {/* Sensor list */}
          {sensors.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
              <p>No sensors detected yet. Make sure your hub is online and sensors are powered on.</p>
            </div>
          ) : (
            sensors.map(s => (
              <div key={s.id} className="card">
                <div className="row-between">
                  <div className="row" style={{ gap: 10 }}>
                    <span style={{ fontSize: '1.5rem' }}>{TYPE_ICON[s.sensor_type]}</span>
                    <div>
                      <div style={{ fontWeight: 700 }}>{s.name || TYPE_LABEL[s.sensor_type]}</div>
                      <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                        Last seen: {timeSince(s.last_seen_at)}
                      </div>
                    </div>
                  </div>
                  <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                    <span className="badge badge-green">Active</span>
                    {s.battery_pct != null && (
                      <span className={`badge ${s.battery_pct < 20 ? 'badge-amber' : 'badge-grey'}`}>
                        🔋 {s.battery_pct}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Help card */}
          <div className={styles.helpCard}>
            <p>💡 <strong>Missing a sensor?</strong> Make sure it's powered on and within 150 m of the hub. Soil nodes transmit every 30 minutes.</p>
          </div>
        </div>
      )}
    </div>
  );
}

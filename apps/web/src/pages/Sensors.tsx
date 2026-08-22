import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ScanSensors } from '../components/ScanSensors';
import styles from './Sensors.module.css';

interface Sensor {
  id: string;
  sensor_type: 'weather_station' | 'soil' | 'greenhouse' | 'indoor';
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

const TYPE_ICON: Record<string, string>  = { soil: '💧', greenhouse: '🏡', indoor: '🌡' };
const TYPE_LABEL: Record<string, string> = { soil: 'Soil Sensor', greenhouse: 'Greenhouse', indoor: 'Indoor Sensor' };

export function SensorsPage() {
  const [device, setDevice]   = useState<DeviceInfo | null>(null);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const loadSensors = () => {
    apiFetch<{ device: DeviceInfo; sensors: Sensor[] }>('/api/v1/sensors')
      .then(d => { setDevice(d.device); setSensors(d.sensors); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSensors(); }, []);

  const deleteSensor = async (id: string) => {
    await apiFetch(`/api/v1/sensors/${id}`, { method: 'DELETE' });
    setSensors(prev => prev.filter(s => s.id !== id));
  };

  const timeSince = (ts: number | null) => {
    if (!ts) return 'Never';
    const mins = Math.round((Date.now() / 1000 - ts) / 60);
    if (mins < 2)  return 'Just now';
    if (mins < 60) return `${mins} mins ago`;
    return `${Math.round(mins / 60)} hrs ago`;
  };

  if (scanning) {
    return (
      <div style={{ padding: 16 }}>
        <ScanSensors onDone={() => { setScanning(false); loadSensors(); }} />
      </div>
    );
  }

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
              <SensorCard key={s.id} sensor={s} timeSince={timeSince} onDelete={deleteSensor} />
            ))
          )}

          {/* Help card + scan button */}
          <div className={styles.helpCard}>
            <p>💡 <strong>Missing a sensor?</strong> Make sure it's powered on and within 150 m of the hub. Soil nodes transmit every 30 minutes.</p>
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => setScanning(true)}
          >
            + Scan for sensors
          </button>
        </div>
      )}
    </div>
  );
}

function SensorCard({
  sensor: s,
  timeSince,
  onDelete,
}: {
  sensor: Sensor;
  timeSince: (ts: number | null) => string;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="card">
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
        <div className="row" style={{ gap: 6 }}>
          <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
            <span className="badge badge-green">Active</span>
            {s.battery_pct != null && (
              <span className={`badge ${s.battery_pct < 20 ? 'badge-amber' : 'badge-grey'}`}>
                🔋 {s.battery_pct}%
              </span>
            )}
          </div>
          <button
            onClick={() => setConfirmDelete(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#9ca3af', padding: '2px 4px' }}
            aria-label="Delete sensor"
            title="Delete sensor"
          >
            ···
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div style={{ marginTop: 10, background: '#fef2f2', borderRadius: 8, padding: '10px 12px' }}>
          <p style={{ fontSize: '0.82rem', color: '#991b1b', marginBottom: 8 }}>
            Remove this sensor? Its readings will be deleted.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem', padding: '8px', flex: 1 }}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
            <button
              style={{ flex: 1, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '8px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
              onClick={() => onDelete(s.id)}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

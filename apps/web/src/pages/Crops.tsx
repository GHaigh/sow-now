import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import styles from './Crops.module.css';

interface Crop {
  id: string;
  crop_key: string;
  display_name: string;
  variety: string | null;
  bed_name: string | null;
  zone: string;
  status: string;
  gdd_accumulated: number;
  gdd_to_harvest_min: number | null;
  gdd_to_harvest_max: number | null;
  sown_at: number | null;
}

const CROP_EMOJI: Record<string, string> = {
  tomato: '🍅', french_bean: '🫘', courgette: '🥒', pea: '🟢',
  carrot: '🥕', potato: '🥔', lettuce: '🥬', sweetcorn: '🌽',
  cucumber: '🥒', strawberry: '🍓', beetroot: '🟣', pumpkin: '🎃',
  onion: '🧅', pepper: '🫑', brassica: '🥦', spinach: '🥬',
  parsnip: '🟡', leek: '🧄',
};

const STATUS_BADGE: Record<string, string> = {
  planned: 'badge-grey', sown: 'badge-blue', germinated: 'badge-green',
  growing: 'badge-green', hardening: 'badge-amber', transplanted: 'badge-green',
  harvested: 'badge-grey', failed: 'badge-red',
};

export function CropsPage() {
  const [crops, setCrops] = useState<Crop[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    setLoading(true);
    apiFetch<Crop[]>('/api/v1/crops')
      .then(setCrops)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const updateStatus = async (id: string, status: string) => {
    await apiFetch(`/api/v1/crops/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setCrops(prev => prev.map(c => c.id === id ? { ...c, status } : c));
  };

  const activeCrops  = crops.filter(c => !['harvested', 'failed'].includes(c.status));
  const archiveCrops = crops.filter(c =>  ['harvested', 'failed'].includes(c.status));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Crops</h1>
          <p>{activeCrops.length} active this season</p>
        </div>
        <button className={`btn btn-primary ${styles.addBtn}`} onClick={() => setShowAdd(true)}>
          + Add
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center' }}><p>Loading…</p></div>
      ) : (
        <div style={{ padding: 16 }} className="stack-12">
          {activeCrops.length === 0 && !showAdd && (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🌱</div>
              <h2 style={{ marginBottom: 8 }}>No crops yet</h2>
              <p>Tap + Add to start tracking your growing season.</p>
            </div>
          )}

          {activeCrops.map(c => (
            <CropCard key={c.id} crop={c} onStatusChange={updateStatus} />
          ))}

          {archiveCrops.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Archive</div>
              {archiveCrops.map(c => (
                <CropCard key={c.id} crop={c} onStatusChange={updateStatus} />
              ))}
            </>
          )}
        </div>
      )}

      {showAdd && <AddCropSheet onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function CropCard({ crop, onStatusChange }: { crop: Crop; onStatusChange: (id: string, status: string) => void }) {
  const emoji = CROP_EMOJI[crop.crop_key] ?? '🌿';
  const max   = crop.gdd_to_harvest_max ?? 1000;
  const pct   = Math.min((crop.gdd_accumulated / max) * 100, 100);
  const next  = nextStatus(crop.status);

  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <div className="row" style={{ gap: 10 }}>
          <span style={{ fontSize: '1.5rem' }}>{emoji}</span>
          <div>
            <div style={{ fontWeight: 700 }}>{crop.display_name}</div>
            <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
              {[crop.bed_name, ZONE_LABEL[crop.zone]].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        <span className={`badge ${STATUS_BADGE[crop.status] ?? 'badge-grey'}`}>
          {crop.status.charAt(0).toUpperCase() + crop.status.slice(1)}
        </span>
      </div>

      {crop.status !== 'planned' && (
        <>
          <div className="row-between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: '0.78rem', color: '#57606a' }}>{Math.round(crop.gdd_accumulated)} GDD</span>
            <span style={{ fontSize: '0.78rem', color: '#57606a' }}>{Math.round(pct)}% to harvest</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}

      {next && (
        <button
          className="btn btn-secondary"
          style={{ marginTop: 10, fontSize: '0.85rem', padding: '10px' }}
          onClick={() => onStatusChange(crop.id, next.status)}
        >
          {next.label}
        </button>
      )}
    </div>
  );
}

function nextStatus(current: string): { status: string; label: string } | null {
  const map: Record<string, { status: string; label: string }> = {
    planned:     { status: 'sown',        label: 'Mark as sown' },
    sown:        { status: 'germinated',  label: 'Germination confirmed ✓' },
    germinated:  { status: 'growing',     label: 'Growing well ✓' },
    growing:     { status: 'harvested',   label: 'Mark as harvested 🎉' },
    hardening:   { status: 'transplanted', label: 'Transplanted ✓' },
    transplanted:{ status: 'harvested',   label: 'Mark as harvested 🎉' },
  };
  return map[current] ?? null;
}

const ZONE_LABEL: Record<string, string> = {
  outdoor:    '🌤 Garden',
  greenhouse: '🏡 Greenhouse',
  indoor:     '🪴 Indoors',
};

function AddCropSheet({ onClose }: { onClose: () => void }) {
  const [cropKey, setCropKey] = useState('tomato');
  const [bedName, setBedName] = useState('');
  const [zone, setZone]       = useState('outdoor');
  const [saving, setSaving]   = useState(false);

  const CROPS = Object.entries(CROP_EMOJI).map(([key, emoji]) => ({
    key, emoji,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
  }));

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/v1/crops', {
        method: 'POST',
        body: JSON.stringify({ crop_key: cropKey, bed_name: bedName || null, zone, status: 'planned' }),
      });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className={styles.sheet}>
      <div className={styles.sheetInner}>
        <div className="row-between" style={{ marginBottom: 20 }}>
          <h2>Add crop</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#57606a' }}>✕</button>
        </div>
        <div className="stack-12">
          <div>
            <label className={styles.label}>Crop</label>
            <select className="input" value={cropKey} onChange={e => setCropKey(e.target.value)}>
              {CROPS.map(c => (
                <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={styles.label}>Where are you growing it?</label>
            <select className="input" value={zone} onChange={e => setZone(e.target.value)}>
              <option value="outdoor">🌤 Garden / outdoors</option>
              <option value="greenhouse">🏡 Greenhouse</option>
              <option value="indoor">🪴 Indoors (windowsill / propagator)</option>
            </select>
          </div>
          <div>
            <label className={styles.label}>Bed name (optional)</label>
            <input className="input" placeholder="e.g. Bed 1, Propagator, South windowsill" value={bedName} onChange={e => setBedName(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Adding…' : 'Add crop'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

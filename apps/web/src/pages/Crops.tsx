import { useEffect, useState, useRef } from 'react';
import { apiFetch, searchVarieties, predictVariety, submitCommunityVariety } from '../lib/api';
import type { Variety, PlantingPlan } from '../lib/api';
import styles from './Crops.module.css';

interface Crop {
  id: string;
  crop_key: string;
  display_name: string;
  variety: string | null;
  variety_id: string | null;
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

const ZONE_LABEL: Record<string, string> = {
  outdoor:    '🌤 Garden',
  greenhouse: '🏡 Greenhouse',
  indoor:     '🪴 Indoors',
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
              <p>Tap + Add to plan your growing season.</p>
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

// ── Crop card ─────────────────────────────────────────────────────────────────

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
            <div style={{ fontWeight: 700 }}>
              {crop.variety ?? crop.display_name}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
              {crop.variety && <span style={{ marginRight: 6 }}>{crop.display_name}</span>}
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
    planned:      { status: 'sown',         label: 'Mark as sown' },
    sown:         { status: 'germinated',   label: 'Germination confirmed ✓' },
    germinated:   { status: 'growing',      label: 'Growing well ✓' },
    growing:      { status: 'harvested',    label: 'Mark as harvested 🎉' },
    hardening:    { status: 'transplanted', label: 'Transplanted ✓' },
    transplanted: { status: 'harvested',    label: 'Mark as harvested 🎉' },
  };
  return map[current] ?? null;
}

// ── Add crop sheet ────────────────────────────────────────────────────────────

const CROPS = Object.entries(CROP_EMOJI).map(([key, emoji]) => ({
  key, emoji,
  label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
}));

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function AddCropSheet({ onClose }: { onClose: () => void }) {
  // Step 1: crop + variety  Step 2: confirm prediction
  const [step, setStep] = useState<'pick' | 'predict' | 'custom'>('pick');

  const [cropKey,   setCropKey]   = useState('tomato');
  const [query,     setQuery]     = useState('');
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [selected,  setSelected]  = useState<Variety | null>(null);
  const [plan,      setPlan]      = useState<PlantingPlan | null>(null);
  const [bedName,   setBedName]   = useState('');
  const [zone,      setZone]      = useState('outdoor');
  const [saving,    setSaving]    = useState(false);
  const [loadingV,  setLoadingV]  = useState(false);
  const [loadingP,  setLoadingP]  = useState(false);

  // Community variety fields
  const [customName,    setCustomName]    = useState('');
  const [customHarMin,  setCustomHarMin]  = useState('');
  const [customHarMax,  setCustomHarMax]  = useState('');
  const [customSupplier,setCustomSupplier]= useState('');

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load varieties when crop changes or query changes
  useEffect(() => {
    setSelected(null);
    setPlan(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setLoadingV(true);
      searchVarieties(cropKey, query)
        .then(setVarieties)
        .finally(() => setLoadingV(false));
    }, query ? 300 : 0);
  }, [cropKey, query]);

  const selectVariety = async (v: Variety) => {
    setSelected(v);
    setLoadingP(true);
    try {
      const result = await predictVariety(v.id);
      setPlan(result.plan);
      setStep('predict');
    } catch {
      setStep('predict'); // show variety without prediction
    } finally {
      setLoadingP(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/v1/crops', {
        method: 'POST',
        body: JSON.stringify({
          crop_key: cropKey,
          variety: selected?.name ?? (step === 'custom' ? customName : null),
          variety_id: selected?.id ?? null,
          bed_name: bedName || null,
          zone,
          status: 'planned',
        }),
      });
      onClose();
    } finally { setSaving(false); }
  };

  const saveCustom = async () => {
    if (!customName || !customHarMin || !customHarMax) return;
    setSaving(true);
    try {
      await submitCommunityVariety({
        crop_key: cropKey,
        name: customName,
        gdd_to_harvest_min: Number(customHarMin),
        gdd_to_harvest_max: Number(customHarMax),
        supplier: customSupplier || undefined,
      });
      await apiFetch('/api/v1/crops', {
        method: 'POST',
        body: JSON.stringify({
          crop_key: cropKey,
          variety: customName,
          bed_name: bedName || null,
          zone,
          status: 'planned',
        }),
      });
      onClose();
    } finally { setSaving(false); }
  };

  // ── Step: variety picker ──────────────────────────────────────────────────
  if (step === 'pick') {
    return (
      <div className={styles.sheet}>
        <div className={styles.sheetInner}>
          <div className="row-between" style={{ marginBottom: 20 }}>
            <h2>Add crop</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#57606a' }}>✕</button>
          </div>

          <div className="stack-12">
            {/* Crop type */}
            <div>
              <label className={styles.label}>Crop</label>
              <select className="input" value={cropKey} onChange={e => { setCropKey(e.target.value); setQuery(''); }}>
                {CROPS.map(c => (
                  <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>
                ))}
              </select>
            </div>

            {/* Variety search */}
            <div>
              <label className={styles.label}>Variety</label>
              <input
                className="input"
                placeholder="Search varieties…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            {/* Variety list */}
            {loadingV ? (
              <p style={{ fontSize: '0.85rem', color: '#9ca3af', textAlign: 'center' }}>Searching…</p>
            ) : (
              <div className="stack-8">
                {varieties.map(v => (
                  <button
                    key={v.id}
                    className={`card ${styles.varietyRow}`}
                    onClick={() => selectVariety(v)}
                    style={{ textAlign: 'left', width: '100%', border: '1.5px solid #e5e7eb', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{v.name}</div>
                        {v.supplier && (
                          <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{v.supplier}</div>
                        )}
                        {v.description && (
                          <div style={{ fontSize: '0.78rem', color: '#57606a', marginTop: 3, lineHeight: 1.4 }}>
                            {v.description.slice(0, 80)}{v.description.length > 80 ? '…' : ''}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontSize: '0.75rem', color: '#57606a' }}>
                          {v.days_to_harvest_min && v.days_to_harvest_max
                            ? `${v.days_to_harvest_min}–${v.days_to_harvest_max} days`
                            : `${v.gdd_to_harvest_min}–${v.gdd_to_harvest_max} GDD`}
                        </div>
                        {v.verified === 1 && (
                          <span className="badge badge-green" style={{ fontSize: '0.65rem', marginTop: 3 }}>✓ Verified</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}

                {varieties.length === 0 && !loadingV && (
                  <div className="card" style={{ textAlign: 'center', padding: 20 }}>
                    <p style={{ fontSize: '0.88rem', color: '#57606a', marginBottom: 12 }}>
                      No varieties found{query ? ` for "${query}"` : ''}.
                    </p>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.85rem' }}
                      onClick={() => { setStep('custom'); }}
                    >
                      + Add your own variety
                    </button>
                  </div>
                )}

                {varieties.length > 0 && (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '0.85rem', marginTop: 4 }}
                    onClick={() => setStep('custom')}
                  >
                    + My variety isn't listed
                  </button>
                )}
              </div>
            )}

            {loadingP && (
              <p style={{ fontSize: '0.85rem', color: '#9ca3af', textAlign: 'center' }}>Getting your planting plan…</p>
            )}

          </div>
        </div>
      </div>
    );
  }

  // ── Step: prediction summary ──────────────────────────────────────────────
  if (step === 'predict' && selected) {
    return (
      <div className={styles.sheet}>
        <div className={styles.sheetInner}>
          <div className="row-between" style={{ marginBottom: 20 }}>
            <h2>{selected.name}</h2>
            <button onClick={() => setStep('pick')} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#57606a' }}>←</button>
          </div>

          {selected.description && (
            <p style={{ fontSize: '0.88rem', color: '#57606a', marginBottom: 16, lineHeight: 1.6 }}>
              {selected.description}
            </p>
          )}

          {plan && (
            <div className="stack-8" style={{ marginBottom: 20 }}>
              {/* Viability warning */}
              {!plan.viable && (
                <div style={{ background: '#fef9c3', border: '1.5px solid #fbbf24', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#92400e', marginBottom: 4 }}>⚠️ May not be viable</div>
                  <p style={{ fontSize: '0.82rem', color: '#92400e', lineHeight: 1.5 }}>{plan.viability_note}</p>
                </div>
              )}
              {plan.viable && plan.viability_note && (
                <div style={{ background: '#fffbeb', border: '1.5px solid #fcd34d', borderRadius: 10, padding: '12px 14px' }}>
                  <p style={{ fontSize: '0.82rem', color: '#78350f', lineHeight: 1.5 }}>💡 {plan.viability_note}</p>
                </div>
              )}

              {/* Planting timeline */}
              <div className="card" style={{ background: '#f0fdf4' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#166534', marginBottom: 12 }}>
                  Your planting plan
                </div>
                <div className="stack-8">
                  {plan.sow_date && (
                    <PlanRow
                      icon={plan.sow_location === 'indoor' ? '🪴' : '🌱'}
                      label={plan.sow_location === 'indoor' ? 'Sow indoors' : 'Sow direct'}
                      date={plan.sow_date}
                    />
                  )}
                  {plan.move_to_greenhouse && (
                    <PlanRow icon="🏡" label="Move to greenhouse" date={plan.move_to_greenhouse} />
                  )}
                  {plan.plant_out_date && (
                    <PlanRow icon="🌤" label="Plant out" date={plan.plant_out_date} />
                  )}
                  {plan.harvest_date_min && plan.harvest_date_max && (
                    <PlanRow
                      icon="🎉"
                      label="Expected harvest"
                      date={`${fmtDate(plan.harvest_date_min)} – ${fmtDate(plan.harvest_date_max)}`}
                      isRange
                    />
                  )}
                </div>
                <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 12, lineHeight: 1.5 }}>
                  Based on your garden's GDD data. Dates update as the season progresses.
                </p>
              </div>
            </div>
          )}

          {/* Location */}
          <div className="stack-12">
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
              <input className="input" placeholder="e.g. Bed 1, South border" value={bedName} onChange={e => setBedName(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Adding…' : `Add ${selected.name} to my plan →`}
            </button>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: custom variety ──────────────────────────────────────────────────
  return (
    <div className={styles.sheet}>
      <div className={styles.sheetInner}>
        <div className="row-between" style={{ marginBottom: 20 }}>
          <h2>Add your variety</h2>
          <button onClick={() => setStep('pick')} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#57606a' }}>←</button>
        </div>
        <p style={{ fontSize: '0.88rem', color: '#57606a', marginBottom: 16, lineHeight: 1.6 }}>
          Can't find your variety? Add it — it'll be shared with the Sow Now community to help other growers.
        </p>
        <div className="stack-12">
          <div>
            <label className={styles.label}>Variety name *</label>
            <input className="input" placeholder="e.g. Tumbling Tom" value={customName} onChange={e => setCustomName(e.target.value)} />
          </div>
          <div>
            <label className={styles.label}>Seed supplier (optional)</label>
            <input className="input" placeholder="e.g. DT Brown, Thompson & Morgan" value={customSupplier} onChange={e => setCustomSupplier(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className={styles.label}>GDD to harvest (min) *</label>
              <input className="input" type="number" placeholder="e.g. 900" value={customHarMin} onChange={e => setCustomHarMin(e.target.value)} />
            </div>
            <div>
              <label className={styles.label}>GDD to harvest (max) *</label>
              <input className="input" type="number" placeholder="e.g. 1100" value={customHarMax} onChange={e => setCustomHarMax(e.target.value)} />
            </div>
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
            <input className="input" placeholder="e.g. Bed 1" value={bedName} onChange={e => setBedName(e.target.value)} />
          </div>
          <p style={{ fontSize: '0.75rem', color: '#9ca3af', lineHeight: 1.5 }}>
            💡 Not sure of GDD? Check the seed packet for days-to-harvest and multiply by 5–7 for an estimate.
          </p>
          <button className="btn btn-primary" onClick={saveCustom} disabled={saving || !customName || !customHarMin || !customHarMax}>
            {saving ? 'Adding…' : 'Add variety & save →'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Plan row component ────────────────────────────────────────────────────────

function PlanRow({ icon, label, date, isRange = false }: {
  icon: string;
  label: string;
  date: string;
  isRange?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: '1.2rem', width: 28, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.78rem', color: '#57606a' }}>{label}</div>
        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1f2328' }}>
          {isRange ? date : fmtDate(date)}
        </div>
      </div>
    </div>
  );
}

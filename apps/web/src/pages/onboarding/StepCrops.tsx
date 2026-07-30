import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import styles from './OnboardingStep.module.css';

interface Props { onNext: () => void; }

const COMMON_CROPS = [
  { key: 'tomato',       label: 'Tomato',       emoji: '🍅' },
  { key: 'french_bean',  label: 'French Bean',  emoji: '🫘' },
  { key: 'courgette',    label: 'Courgette',    emoji: '🥒' },
  { key: 'pea',          label: 'Pea',          emoji: '🟢' },
  { key: 'carrot',       label: 'Carrot',       emoji: '🥕' },
  { key: 'potato',       label: 'Potato',       emoji: '🥔' },
  { key: 'lettuce',      label: 'Lettuce',      emoji: '🥬' },
  { key: 'sweetcorn',    label: 'Sweetcorn',    emoji: '🌽' },
  { key: 'cucumber',     label: 'Cucumber',     emoji: '🥒' },
  { key: 'strawberry',   label: 'Strawberry',   emoji: '🍓' },
  { key: 'beetroot',     label: 'Beetroot',     emoji: '🟣' },
  { key: 'pumpkin',      label: 'Pumpkin',      emoji: '🎃' },
];

export function StepCrops({ onNext }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) =>
    setSelected(s => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const handleNext = async () => {
    setSaving(true);
    try {
      await Promise.all(
        [...selected].map(crop_key =>
          apiFetch('/api/v1/crops', {
            method: 'POST',
            body: JSON.stringify({ crop_key, status: 'planned' }),
          })
        )
      );
    } catch { /* non-fatal — can add crops later */ }
    finally { setSaving(false); onNext(); }
  };

  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>🥕</div>
        <h1>What are you growing?</h1>
        <p>Select everything you're planning this season. You can add more later.</p>
      </div>

      <div className={styles.cropGrid}>
        {COMMON_CROPS.map(({ key, label, emoji }) => (
          <button
            key={key}
            className={`${styles.cropChip} ${selected.has(key) ? styles.cropChipSelected : ''}`}
            onClick={() => toggle(key)}
          >
            <span>{emoji}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button className="btn btn-primary" onClick={handleNext} disabled={saving}>
          {saving ? 'Saving…' : selected.size === 0 ? 'Skip for now →' : `Save ${selected.size} crop${selected.size > 1 ? 's' : ''} →`}
        </button>
      </div>
    </div>
  );
}

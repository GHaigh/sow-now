import { useState } from 'react';
import styles from './OnboardingStep.module.css';

interface Props { onNext: () => void; }

export function StepNameBeds({ onNext }: Props) {
  const [beds, setBeds] = useState(['Bed 1', 'Bed 2']);
  const [newBed, setNewBed] = useState('');

  const addBed = () => {
    if (newBed.trim() && beds.length < 8) {
      setBeds(b => [...b, newBed.trim()]);
      setNewBed('');
    }
  };

  const removeBed = (i: number) => setBeds(b => b.filter((_, idx) => idx !== i));

  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>🗺</div>
        <h1>Name your beds</h1>
        <p>Give each growing area a name — this is how your sensor readings and advice will be labelled.</p>
      </div>

      <div className="stack-8" style={{ marginTop: 20 }}>
        {beds.map((bed, i) => (
          <div key={i} className="card row" style={{ gap: 10 }}>
            <span style={{ fontSize: '1.1rem' }}>🌿</span>
            <span className="fill" style={{ fontWeight: 600 }}>{bed}</span>
            <button
              onClick={() => removeBed(i)}
              style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '1.1rem', cursor: 'pointer' }}
              aria-label="Remove"
            >✕</button>
          </div>
        ))}

        {beds.length < 8 && (
          <div className="card row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Add a bed name…"
              value={newBed}
              onChange={e => setNewBed(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addBed()}
            />
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '13px 16px' }} onClick={addBed}>
              Add
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button className="btn btn-primary" onClick={onNext} disabled={beds.length === 0}>
          Continue →
        </button>
      </div>
    </div>
  );
}

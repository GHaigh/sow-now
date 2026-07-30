import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import styles from './Advice.module.css';

interface AdviceData {
  date: string;
  summary: string;
  actions: string[];
  isFresh: boolean;
  isFirst?: boolean;
  generated_at?: number;
}

export function AdvicePage() {
  const [advice, setAdvice] = useState<AdviceData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<AdviceData>('/api/v1/advice/today')
      .then(setAdvice)
      .catch(e => setError((e as Error).message));
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Advice</h1>
        <p>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</p>
      </div>

      {error && (
        <div style={{ padding: 16 }}>
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <p className="text-red">{error}</p>
          </div>
        </div>
      )}

      {advice && (
        <div style={{ padding: 16 }} className="stack-12">
          {!advice.isFresh && (
            <div className="badge badge-grey" style={{ alignSelf: 'flex-start' }}>
              Last updated {new Date(advice.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
            </div>
          )}

          {advice.isFirst ? (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🌱</div>
              <h2 style={{ marginBottom: 8 }}>Your first report is on its way</h2>
              <p>Once your sensors have collected a full day of data, you'll get your first personalised advice at 7am tomorrow.</p>
            </div>
          ) : (
            <>
              <div className={`card ${styles.summaryCard}`}>
                <div className={styles.summaryIcon}>💡</div>
                <h2 className={styles.summaryTitle}>3 things for today</h2>
              </div>
              {advice.actions.map((action, i) => (
                <div key={i} className={`card ${styles.actionCard}`}>
                  <div className={styles.actionNum}>{i + 1}</div>
                  <p className={styles.actionText}>{action}</p>
                </div>
              ))}
              {advice.generated_at && (
                <p style={{ fontSize: '0.75rem', color: '#d1d5db', textAlign: 'center' }}>
                  Generated at {new Date(advice.generated_at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {!advice && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <p>Loading advice…</p>
        </div>
      )}
    </div>
  );
}

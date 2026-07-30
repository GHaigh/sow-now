import styles from './OnboardingStep.module.css';

interface Props { onNext: () => void; }

export function StepWifi({ onNext }: Props) {
  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>📶</div>
        <h1>Plug in your hub</h1>
        <p>Connect the USB-C cable to the hub and plug it into a wall socket near a window facing your garden.</p>
      </div>

      <div className="stack-12" style={{ marginTop: 24 }}>
        {[
          { n: '1', title: 'Plug in', desc: 'Connect the USB-C power cable. The hub light will flash green.' },
          { n: '2', title: 'Position', desc: 'Place it on a windowsill facing your garden. The small antenna should point up.' },
          { n: '3', title: 'Wait 30 seconds', desc: 'The hub connects to your Wi-Fi automatically using your home network.' },
        ].map(({ n, title, desc }) => (
          <div key={n} className="card row" style={{ gap: 14 }}>
            <div className={styles.stepNum}>{n}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{title}</div>
              <div style={{ fontSize: '0.83rem', color: '#57606a', marginTop: 2 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.hint}>
        <p>💡 The hub connects using your existing Wi-Fi — no app or Bluetooth pairing needed.</p>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button className="btn btn-primary" onClick={onNext}>
          Hub is plugged in →
        </button>
      </div>
    </div>
  );
}

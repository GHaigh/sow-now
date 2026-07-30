import styles from './OnboardingStep.module.css';

interface Props { onNext: () => void; }

export function StepWifi({ onNext }: Props) {
  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>📶</div>
        <h1>Connect hub to Wi-Fi</h1>
        <p>Your hub creates its own temporary Wi-Fi hotspot on first boot so you can tell it your home network details.</p>
      </div>

      <div className="stack-12" style={{ marginTop: 24 }}>
        {[
          { n: '1', title: 'Plug in the hub', desc: 'Connect the USB-C power cable. Wait about 30 seconds for it to start up.' },
          { n: '2', title: 'Join the hub hotspot', desc: 'On your phone, go to Wi-Fi settings and connect to the network called SowNow-XXXX (last 4 digits will be unique to your hub).' },
          { n: '3', title: 'Enter your Wi-Fi details', desc: 'A setup page will open automatically. Pick your home Wi-Fi network and enter your password, then tap Connect.' },
          { n: '4', title: 'Rejoin your home Wi-Fi', desc: 'The hub hotspot will disappear as it joins your home network. Switch your phone back to your home Wi-Fi, then tap Continue below.' },
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
        <p>💡 If the setup page doesn't open automatically, open a browser and go to <strong>192.168.4.1</strong></p>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button className="btn btn-primary" onClick={onNext}>
          Hub is on my Wi-Fi →
        </button>
      </div>
    </div>
  );
}

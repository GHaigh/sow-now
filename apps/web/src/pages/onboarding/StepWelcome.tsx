import styles from './OnboardingStep.module.css';

interface Props { onNext: () => void; }

export function StepWelcome({ onNext }: Props) {
  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>🌱</div>
        <h1>Welcome to Sow Now</h1>
        <p>
          Your sensors, your soil, your season — turned into precise daily
          advice. Let's get your garden connected in about 5 minutes.
        </p>
      </div>

      <div className={styles.featureList}>
        {[
          ['📡', 'Reads your Ecowitt weather station wirelessly'],
          ['💧', 'Monitors soil moisture in each of your beds'],
          ['🌡', 'Tracks your greenhouse separately from the garden'],
          ['📅', 'Tells you exactly when to sow, water, and harvest'],
        ].map(([icon, text]) => (
          <div key={text} className={styles.feature}>
            <span className={styles.featureIcon}>{icon}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 32 }}>
        <button className="btn btn-primary" onClick={onNext}>
          Let's get started →
        </button>
      </div>
    </div>
  );
}

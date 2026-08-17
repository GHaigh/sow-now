import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import styles from './Login.module.css';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const accountDeleted = new URLSearchParams(window.location.search).get('deleted') === '1';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email);
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.icon}>📬</div>
          <h1>Check your email</h1>
          <p>We sent a sign-in link to <strong>{email}</strong>. Tap it to continue.</p>
          <button className="btn btn-ghost" style={{ marginTop: 24 }} onClick={() => setSent(false)}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {accountDeleted && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10,
          padding: '12px 16px', fontSize: '13px', color: '#166534',
          marginBottom: 16, textAlign: 'center',
        }}>
          Your account has been permanently deleted. Sorry to see you go.
        </div>
      )}
      <div className={styles.hero}>
        <div className={styles.logo}>🌱</div>
        <h1 className={styles.brand}>Sow Now</h1>
        <p className={styles.tagline}>Your season starts here.</p>
      </div>
      <div className={styles.card}>
        <h2>Sign in</h2>
        <p style={{ marginBottom: 20 }}>We'll send a magic link to your email — no password needed.</p>
        <form onSubmit={handleSubmit} className="stack-12">
          <input
            className="input"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            inputMode="email"
          />
          {error && <p className="text-red" style={{ fontSize: '0.85rem' }}>{error}</p>}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading || !email}
          >
            {loading ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
      </div>
      <p className={styles.footer}>
        New to Sow Now? <a href="https://sow-now.uk">Learn more</a>
      </p>
    </div>
  );
}

/**
 * InstallBanner — prompts the customer to add the app to their home screen.
 *
 * Shows automatically when:
 *   - On Android: browser fires the beforeinstallprompt event (Chrome, Edge)
 *   - On iOS Safari: app is not already running in standalone mode
 *
 * Dismissed state is persisted in localStorage so it doesn't re-appear
 * every visit after the customer has seen it.
 */

import { useState, useEffect } from 'react';
import styles from './InstallBanner.module.css';

type Platform = 'android' | 'ios' | null;

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return null;
  const ua = navigator.userAgent;
  // Already installed as PWA — don't show
  if (window.matchMedia('(display-mode: standalone)').matches) return null;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return null;
}

export function InstallBanner() {
  const [platform, setPlatform] = useState<Platform>(null);
  const [dismissed, setDismissed] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if (localStorage.getItem('install-banner-dismissed')) {
      setDismissed(true);
      return;
    }

    setPlatform(detectPlatform());

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem('install-banner-dismissed', '1');
  };

  const install = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') dismiss();
      setDeferredPrompt(null);
    }
  };

  // Don't show if dismissed, not on mobile, or already installed
  if (dismissed || !platform) return null;
  // On Android only show if we have the install prompt or no prompt yet (show instructions)
  // On iOS always show instructions (no install API available)

  return (
    <div className={styles.banner}>
      <div className={styles.content}>
        <span className={styles.icon}>🌱</span>
        <div className={styles.text}>
          <strong>Add to Home Screen</strong>
          <span>
            {platform === 'android'
              ? 'Install the app for quick access and daily advice reminders.'
              : 'Tap the Share button then "Add to Home Screen" for quick access.'}
          </span>
        </div>
      </div>
      <div className={styles.actions}>
        {platform === 'android' && deferredPrompt ? (
          <button className={styles.installBtn} onClick={install}>Install</button>
        ) : (
          <button className={styles.howBtn} onClick={() => {
            // Show instructions inline by toggling — handled below
            const el = document.getElementById('install-instructions');
            if (el) el.classList.toggle(styles.visible!);
          }}>How?</button>
        )}
        <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">✕</button>
      </div>

      {/* iOS step-by-step instructions (hidden by default) */}
      {platform === 'ios' && (
        <div id="install-instructions" className={styles.instructions}>
          <ol>
            <li>Tap the <strong>Share</strong> button <span className={styles.shareIcon}>⎙</span> at the bottom of Safari</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
            <li>Tap <strong>Add</strong> — done!</li>
          </ol>
          <p className={styles.note}>Only works in Safari, not Chrome or Firefox on iPhone.</p>
        </div>
      )}
    </div>
  );
}

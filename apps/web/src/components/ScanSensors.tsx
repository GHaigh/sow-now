/**
 * ScanSensors — "scan for existing sensors" component.
 *
 * Polls /api/v1/sensors/claim/candidates every 5 seconds for up to 5 minutes.
 * Shows all unclaimed sensors currently being heard, with the readings most
 * useful for the customer to recognise their own hardware:
 *
 *   WS69  — temp, humidity, wind, rain  (match to current garden conditions)
 *   WH31  — temp, humidity              (button-press to confirm if ambiguous)
 *   WH51  — soil moisture, soil temp    (+ last-4 RF ID from label)
 *
 * Customer taps a card to claim it. After claiming, the card turns green
 * and is removed from the candidates list.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchScanCandidates, confirmClaim, startSensorClaim, pollSensorClaim } from '../lib/api';
import type { ScanCandidate } from '../lib/api';
import styles from '../pages/onboarding/OnboardingStep.module.css';

const SCAN_DURATION_S = 300; // 5 minutes
const POLL_INTERVAL_MS = 5000;

const TYPE_ICON: Record<string, string> = {
  soil:      '💧',
  greenhouse: '🏡',
  indoor:    '🌡',
};

const TYPE_LABEL: Record<string, string> = {
  soil:      'Soil Sensor',
  greenhouse: 'Greenhouse Sensor',
  indoor:    'Indoor Sensor',
};

interface Props {
  /** Called when the customer is done with this scan phase */
  onDone: () => void;
}

export function ScanSensors({ onDone }: Props) {
  const [candidates, setCandidates] = useState<ScanCandidate[]>([]);
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [claiming, setClaiming] = useState<string | null>(null); // rf_id currently being confirmed
  const [buttonPressRfId, setButtonPressRfId] = useState<string | null>(null); // WH31 awaiting button press
  const [secondsLeft, setSecondsLeft] = useState(SCAN_DURATION_S);
  const [scanActive, setScanActive] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const claimIdRef = useRef<string | null>(null);
  const claimPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch candidates ────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const all = await fetchScanCandidates();
      setCandidates(all.filter((c: ScanCandidate) => !claimed.has(c.rf_id)));
    } catch { /* keep showing last result */ }
  }, [claimed]);

  useEffect(() => {
    if (!scanActive) return;
    refresh();
    pollRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [scanActive, refresh]);

  // ── Countdown timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          setScanActive(false);
          if (pollRef.current) clearInterval(pollRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Claim a sensor directly (WS69, WH51) ───────────────────────────────────
  const claimDirect = async (rfId: string) => {
    setClaiming(rfId);
    try {
      await confirmClaim(rfId);
      setClaimed(prev => new Set(prev).add(rfId));
      setCandidates(prev => prev.filter(c => c.rf_id !== rfId));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setClaiming(null);
    }
  };

  // ── WH31: start button-press claim window, then poll ───────────────────────
  const claimWH31 = async (rfId: string) => {
    setClaiming(rfId);
    setButtonPressRfId(rfId);
    try {
      const claimId = await startSensorClaim('greenhouse');
      claimIdRef.current = claimId;
      claimPollRef.current = setInterval(async () => {
        try {
          const result = await pollSensorClaim(claimId);
          if (result.status === 'claimed') {
            clearInterval(claimPollRef.current!);
            setClaimed(prev => new Set(prev).add(rfId));
            setCandidates(prev => prev.filter(c => c.rf_id !== rfId));
            setButtonPressRfId(null);
            setClaiming(null);
          } else if (result.status === 'timeout') {
            clearInterval(claimPollRef.current!);
            setButtonPressRfId(null);
            setClaiming(null);
            alert('Button press not detected — try again');
          }
        } catch {
          clearInterval(claimPollRef.current!);
          setButtonPressRfId(null);
          setClaiming(null);
        }
      }, 2000);
    } catch (err) {
      alert((err as Error).message);
      setClaiming(null);
      setButtonPressRfId(null);
    }
  };

  const handleClaim = (c: ScanCandidate) => {
    if (claiming) return;
    // greenhouse and indoor sensors require button-press confirmation;
    // soil sensors are claimed directly by RF ID
    if (c.sensor_type === 'greenhouse' || c.sensor_type === 'indoor') {
      claimWH31(c.rf_id);
    } else {
      claimDirect(c.rf_id);
    }
  };

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timerLabel = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <div className={styles.step}>
      <div className={styles.hero}>
        <div className={styles.emoji}>📡</div>
        <h1>Scanning for sensors</h1>
        <p>
          {scanActive
            ? `Your hub is listening for nearby sensors. Tap any you recognise to claim them.`
            : `Scan complete. Tap any sensor below to claim it.`}
        </p>
      </div>

      {/* Timer bar */}
      {scanActive && (
        <div style={{ margin: '12px 0 4px', textAlign: 'center' }}>
          <div style={{
            height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${(secondsLeft / SCAN_DURATION_S) * 100}%`,
              background: '#166534',
              transition: 'width 1s linear',
              borderRadius: 2,
            }} />
          </div>
          <p style={{ fontSize: '0.78rem', color: '#57606a', marginTop: 4 }}>
            {timerLabel} remaining
          </p>
        </div>
      )}

      {/* Claimed count */}
      {claimed.size > 0 && (
        <div className={styles.hint} style={{ marginTop: 8 }}>
          <p>✓ {claimed.size} sensor{claimed.size > 1 ? 's' : ''} claimed</p>
        </div>
      )}

      {/* Candidates list */}
      <div className="stack-8" style={{ marginTop: 12, flex: 1 }}>
        {candidates.length === 0 && scanActive && (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <div className={styles.spinner} />
            <p style={{ marginTop: 12, fontSize: '0.85rem', color: '#57606a' }}>
              Listening… sensors will appear here as they're heard.
            </p>
          </div>
        )}

        {candidates.length === 0 && !scanActive && claimed.size === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <p style={{ fontSize: '0.85rem', color: '#57606a' }}>
              No existing sensors found within range.
            </p>
          </div>
        )}

        {candidates.map(c => (
          <CandidateCard
            key={c.rf_id}
            candidate={c}
            isClaiming={claiming === c.rf_id}
            awaitingButton={buttonPressRfId === c.rf_id}
            disabled={!!claiming}
            onClaim={() => handleClaim(c)}
          />
        ))}
      </div>

      {/* Footer actions */}
      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button className="btn btn-primary" onClick={onDone}>
          {claimed.size > 0
            ? `Continue with ${claimed.size} sensor${claimed.size > 1 ? 's' : ''} →`
            : 'None of these are mine →'}
        </button>
      </div>
    </div>
  );
}

// ── Candidate card ────────────────────────────────────────────────────────────

interface CardProps {
  candidate: ScanCandidate;
  isClaiming: boolean;
  awaitingButton: boolean;
  disabled: boolean;
  onClaim: () => void;
}

function CandidateCard({ candidate: c, isClaiming, awaitingButton, disabled, onClaim }: CardProps) {
  return (
    <div
      className="card"
      style={{
        opacity: disabled && !isClaiming ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
        border: isClaiming ? '2px solid #166534' : undefined,
      }}
      onClick={disabled ? undefined : onClaim}
    >
      <div className="row-between">
        <div className="row" style={{ gap: 10 }}>
          <span style={{ fontSize: '1.5rem' }}>{TYPE_ICON[c.sensor_type]}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{TYPE_LABEL[c.sensor_type]}</div>
            <ReadingsSummary c={c} />
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          {isClaiming && awaitingButton ? (
            <span className="badge badge-amber">Press button…</span>
          ) : isClaiming ? (
            <span className="badge badge-grey">Claiming…</span>
          ) : (
            <span className="badge" style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
              Tap to claim
            </span>
          )}
        </div>
      </div>

      {awaitingButton && (
        <p style={{ fontSize: '0.8rem', color: '#92400e', marginTop: 8, background: '#fffbeb', borderRadius: 8, padding: '8px 10px' }}>
          Press the button on your sensor now to confirm it's yours.
        </p>
      )}
    </div>
  );
}

function ReadingsSummary({ c }: { c: ScanCandidate }) {
  const parts: string[] = [];

  if (c.sensor_type === 'soil') {
    if (c.soil_moisture_pct != null) parts.push(`${Math.round(c.soil_moisture_pct)}% moisture`);
    if (c.soil_temp_c != null)       parts.push(`${c.soil_temp_c.toFixed(1)}°C soil`);
    if (c.last4)                     parts.push(`ID …${c.last4}`);
  } else {
    // greenhouse / indoor
    if (c.temp_c != null)       parts.push(`${c.temp_c.toFixed(1)}°C`);
    if (c.humidity_pct != null) parts.push(`${Math.round(c.humidity_pct)}% humidity`);
  }

  if (parts.length === 0) {
    return <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>Waiting for reading…</div>;
  }

  return (
    <div style={{ fontSize: '0.78rem', color: '#57606a' }}>
      {parts.join(' · ')}
    </div>
  );
}

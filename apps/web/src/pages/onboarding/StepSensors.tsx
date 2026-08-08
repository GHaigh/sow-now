/**
 * StepSensors — onboarding wrapper around ScanSensors.
 * Replaces the old polling-only step with the full scan + claim flow.
 */
import { ScanSensors } from '../../components/ScanSensors';

interface Props { onNext: () => void; }

export function StepSensors({ onNext }: Props) {
  return <ScanSensors onDone={onNext} />;
}

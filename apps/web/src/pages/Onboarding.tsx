import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StepWelcome }      from './onboarding/StepWelcome';
import { StepScanQR }       from './onboarding/StepScanQR';
import { StepWifi }         from './onboarding/StepWifi';
import { StepSensors }      from './onboarding/StepSensors';
import { StepNameSensors }  from './onboarding/StepNameSensors';
import { StepNameBeds }     from './onboarding/StepNameBeds';
import { StepCrops }        from './onboarding/StepCrops';
import { StepLocation }     from './onboarding/StepLocation';
import styles from './Onboarding.module.css';

const STEPS = 8;

export function OnboardingPage() {
  const [step, setStep] = useState(1);
  const navigate = useNavigate();

  const next = () => step < STEPS ? setStep(s => s + 1) : navigate('/');
  const back = () => step > 1 && setStep(s => s - 1);

  const progress = ((step - 1) / (STEPS - 1)) * 100;

  return (
    <div className={styles.page}>
      {/* Progress bar */}
      <div className={styles.header}>
        {step > 1 && (
          <button className={styles.back} onClick={back} aria-label="Back">
            ←
          </button>
        )}
        <div className={styles.progressWrap}>
          <div className="progress-track" style={{ flex: 1 }}>
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.stepCount}>{step} / {STEPS}</span>
        </div>
      </div>

      {/* Step content */}
      <div className={styles.content}>
        {step === 1 && <StepWelcome      onNext={next} />}
        {step === 2 && <StepScanQR       onNext={next} />}
        {step === 3 && <StepWifi         onNext={next} />}
        {step === 4 && <StepSensors      onNext={next} />}
        {step === 5 && <StepNameSensors  onNext={next} />}
        {step === 6 && <StepNameBeds     onNext={next} />}
        {step === 7 && <StepCrops        onNext={next} />}
        {step === 8 && <StepLocation     onNext={next} />}
      </div>
    </div>
  );
}

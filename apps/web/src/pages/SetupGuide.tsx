/**
 * SetupGuide — public customer-facing setup instructions page.
 * Accessible at /guide — no login required.
 * Can be linked from the box insert / QR card.
 */

import styles from './SetupGuide.module.css';

interface Step {
  n: string;
  title: string;
  body: string;
  tip?: string;
  substeps?: string[];
}

const STEPS: Step[] = [
  {
    n: '1',
    title: 'Open the Sow Now app',
    body: 'On your phone, open your browser and go to app.sow-now.uk. Create a free account, then add the app to your home screen so you can open it with one tap each morning.',
    substeps: [
      'iPhone (Safari): tap the Share button ⎙ at the bottom of the screen, then tap "Add to Home Screen", then tap Add',
      'Android (Chrome): tap the three-dot menu in the top right, then tap "Add to Home Screen" or "Install app"',
      'Note: on iPhone this only works in Safari — not Chrome or Firefox',
    ],
    tip: 'Adding to your home screen also lets the app work better offline and keeps your place when you switch apps.',
  },
  {
    n: '2',
    title: 'Plug in your hub',
    body: 'Connect the USB-C power cable to the white Sow Now hub and plug it into a power socket. The green light will flash — this means it\'s starting up.',
    tip: 'Place the hub centrally in your growing space. It can receive sensors up to 150 m away.',
  },
  {
    n: '3',
    title: 'Connect the hub to your Wi-Fi',
    body: 'The hub creates its own temporary Wi-Fi hotspot. On your phone:',
    substeps: [
      'Go to your phone\'s Wi-Fi settings',
      'Connect to the network called SowNow-XXXX (the last 4 characters are unique to your hub)',
      'A setup page will open automatically — if it doesn\'t, open a browser and go to 192.168.4.1',
      'Select your home Wi-Fi network from the list and enter your password, then tap Connect',
      'Wait 30 seconds — the hotspot will disappear as the hub joins your home network',
      'Switch your phone back to your home Wi-Fi',
    ],
    tip: 'If your Wi-Fi password contains unusual characters, type it carefully — the hub won\'t connect if it\'s wrong.',
  },
  {
    n: '4',
    title: 'Scan the QR code to link your hub',
    body: 'Open the Sow Now app. At the Connect your hub step, scan the QR code on the card inside your box, or type the code printed below it (e.g. SN-A1B2C3D4).',
    tip: 'The hub and app communicate via the internet — make sure both your phone and hub are online.',
  },
  {
    n: '5',
    title: 'Add your sensors',
    body: 'The app will scan for any sensors already in range. If your sensors are already powered on, they\'ll appear in the list — tap each one you recognise to claim it.',
    substeps: [
      'WS69 weather station — the app shows current temperature, humidity and wind. If the readings match your garden, tap to claim it',
      'WH31 greenhouse sensor — press the button on the sensor when prompted to confirm it\'s yours',
      'WH51 soil sensor — find the 4-digit ID printed on the label of your sensor and match it to the list',
    ],
    tip: 'If you\'re adding brand new sensors, insert the batteries one at a time. Each sensor will appear in the app as it powers on.',
  },
  {
    n: '6',
    title: 'Name your sensors',
    body: 'Give each sensor a name that matches where it\'s placed — for example "Raised bed 1", "Greenhouse" or "Back garden". This is how your readings and advice will be labelled.',
  },
  {
    n: '7',
    title: 'Name your growing beds',
    body: 'Tell the app about each of your growing areas. You can add as many beds as you like and rename them any time.',
  },
  {
    n: '8',
    title: 'Plan your crops by variety',
    body: 'Tap + Add for each crop you\'re growing. Search by variety name — Gardener\'s Delight, Charlotte, Padrón — and the app instantly shows your personalised sow date, when to move to the greenhouse, plant-out date, and expected first harvest based on your garden\'s GDD data. Can\'t find your variety? Add it and it\'ll be shared with the Sow Now community.',
    tip: 'The more crops you add now, the more useful your daily advice will be from day one.',
  },
  {
    n: '9',
    title: 'You\'re all set!',
    body: 'Your hub will upload sensor readings every 5 minutes. Daily advice cards appear on your dashboard each morning based on your actual growing conditions.',
    tip: 'Sensor readings may take up to 5 minutes to appear after first setup.',
  },
];

const TROUBLESHOOTING = [
  {
    q: 'The SowNow-XXXX hotspot doesn\'t appear',
    a: 'Make sure the hub is powered on (green light flashing). If the light is solid or off, unplug and replug the power cable. The hotspot only appears on first boot — if you\'ve already configured Wi-Fi, the hotspot won\'t show again.',
  },
  {
    q: 'The setup page doesn\'t open automatically',
    a: 'Open a browser on your phone and type 192.168.4.1 in the address bar. Make sure you\'re connected to the SowNow-XXXX network, not your home Wi-Fi.',
  },
  {
    q: 'My sensor isn\'t appearing in the app',
    a: 'Make sure the sensor is powered on and within 150 m of the hub. WH51 soil sensors transmit every 30 minutes — wait up to 30 minutes after inserting batteries before scanning. WS69 and WH31 transmit every 60 seconds.',
  },
  {
    q: 'The hub shows offline in the app',
    a: 'Check your home Wi-Fi is working. Unplug the hub and plug it back in. If it still shows offline after 5 minutes, check the hub is within range of your router.',
  },
  {
    q: 'I accidentally claimed the wrong sensor',
    a: 'Go to the Sensors page in the app, tap the sensor, and rename or delete it. Then run Scan for sensors again to find your correct sensor.',
  },
];

export function SetupGuidePage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.logo}>🌱 Sow Now</div>
        <h1>Setup guide</h1>
        <p>Get your hub and sensors connected in about 10 minutes.</p>
      </div>

      <div className={styles.steps}>
        {STEPS.map(step => (
          <div key={step.n} className={styles.step}>
            <div className={styles.stepNum}>{step.n}</div>
            <div className={styles.stepBody}>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              {step.substeps && (
                <ol className={styles.substeps}>
                  {step.substeps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              )}
              {step.tip && (
                <div className={styles.tip}>
                  💡 {step.tip}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <h2>Troubleshooting</h2>
        <div className={styles.faqs}>
          {TROUBLESHOOTING.map(({ q, a }) => (
            <div key={q} className={styles.faq}>
              <div className={styles.faqQ}>{q}</div>
              <div className={styles.faqA}>{a}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.footer}>
        <p>Need more help? Email <a href="mailto:hello@sow-now.uk">hello@sow-now.uk</a></p>
        <a href="/login" className={styles.appLink}>Open the app →</a>
      </div>
    </div>
  );
}

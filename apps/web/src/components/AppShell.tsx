import { NavLink } from 'react-router-dom';
import styles from './AppShell.module.css';

const NAV = [
  { to: '/',        icon: '🌱', label: 'Today'   },
  { to: '/advice',  icon: '💡', label: 'Advice'  },
  { to: '/crops',   icon: '🥕', label: 'Crops'   },
  { to: '/sensors', icon: '📡', label: 'Sensors' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>{children}</main>
      <nav className={styles.nav}>
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
            }
          >
            <span className={styles.navIcon}>{icon}</span>
            <span className={styles.navLabel}>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

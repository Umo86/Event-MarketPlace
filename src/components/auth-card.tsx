import Link from 'next/link';
import { Stack } from '@mantine/core';
import { PLATFORM_NAME } from '@/lib/branding';
import styles from './auth-card.module.css';

export function Wordmark() {
  return (
    <span className={styles.brand}>
      <span className={styles.mark} aria-hidden>
        M
      </span>
      <span className="wordmark">{PLATFORM_NAME}</span>
    </span>
  );
}

/** The frame for account sign-in and the short pages around it (two-factor, invitations). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link href="/" aria-label={`${PLATFORM_NAME} home`} style={{ textDecoration: 'none' }}>
          <Wordmark />
        </Link>
      </header>
      <main id="content" className={styles.main} tabIndex={-1}>
        <div className={styles.column}>
          <div className={styles.card}>
            <h1 className={`page-title ${styles.title}`}>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
            <Stack gap="md" className={styles.body}>
              {children}
            </Stack>
          </div>
          <p className={styles.foot}>Every change is recorded. Media10 will never ask for your password.</p>
        </div>
      </main>
    </div>
  );
}

'use client';

/** Last-resort error page when the root layout itself fails. Plain HTML, no app styles. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f6f5f1', margin: 0 }}>
        <main style={{ maxWidth: 480, margin: '15vh auto', padding: 24, background: '#fff', border: '1px solid #e1ded6', borderRadius: 8 }}>
          <title>Something went wrong · Event MarketPlace</title>
          <h1 style={{ fontSize: 22, marginTop: 0 }}>Something went wrong</h1>
          <p style={{ color: '#5f5c55' }}>Sorry, this page couldn’t load. Please try again in a moment.</p>
          {digest ? <p style={{ color: '#5f5c55', fontSize: 12 }}>Reference: {digest}</p> : null}
          <button type="button" onClick={() => retry()} style={{ padding: '8px 16px', borderRadius: 6, border: 0, background: '#0b5d57', color: '#fff', cursor: 'pointer' }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

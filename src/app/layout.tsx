import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dropzone/styles.css';
// Typefaces are served from this site, so pages make no requests to font services.
import '@fontsource-variable/public-sans/wght.css';
import '@fontsource-variable/fraunces/wght.css';
import './globals.css';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { mantineHtmlProps } from '@mantine/core';
import { Providers } from '@/components/providers';
import { PLATFORM_NAME } from '@/lib/branding';

export const metadata: Metadata = {
  title: { default: PLATFORM_NAME, template: `%s · ${PLATFORM_NAME}` },
  description: 'Order stand services from approved suppliers.',
  robots: { index: false, follow: false },
};

// Always the light colour scheme, so Mantine's colour-scheme script (an inline script) isn't needed.
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Every page is rendered per request, so each gets its own Content-Security-Policy nonce (proxy.ts).
  await connection();
  return (
    <html lang="en-GB" {...mantineHtmlProps}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

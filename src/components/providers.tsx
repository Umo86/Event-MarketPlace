'use client';

import { useEffect } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { theme } from '@/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  // Marks the page as ready (browser tests wait for it before typing).
  useEffect(() => {
    document.documentElement.dataset.ready = 'true';
  }, []);
  return (
    <MantineProvider theme={theme} defaultColorScheme="light" forceColorScheme="light">
      <Notifications position="top-right" limit={4} />
      {children}
    </MantineProvider>
  );
}

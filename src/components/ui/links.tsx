'use client';

import Link from 'next/link';
import { Anchor, Button, type AnchorProps, type ButtonProps } from '@mantine/core';

/**
 * Mantine buttons and anchors that navigate with Next.js links. Server components can't pass
 * `component={Link}` to Mantine (a function can't cross to the browser), so they use these.
 */
export function LinkButton({ href, children, ...props }: ButtonProps & { href: string; children: React.ReactNode }) {
  return (
    <Button component={Link} href={href} {...props}>
      {children}
    </Button>
  );
}

export function LinkAnchor({ href, children, className = 'text-link', ...props }: AnchorProps & { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Anchor component={Link} href={href} className={className} {...props}>
      {children}
    </Anchor>
  );
}

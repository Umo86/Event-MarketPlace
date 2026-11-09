'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Box, Button, ColorInput, FileButton, Grid, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { Panel } from '@/components/ui/panel';
import { useAction } from '@/lib/use-action';
import { checkAccentColour, checkMainColour, DARK_TEXT } from '@/lib/branding';
import { brandingImageAction, updateBrandingAction } from '../../../actions';

type Slot = 'logo' | 'logoLight' | 'banner' | 'favicon';
type Values = { marketplaceName: string; primaryColor: string; accentColor: string; emailSenderName: string };

const SLOTS: { slot: Slot; label: string; help: string; accept: string }[] = [
  { slot: 'logo', label: 'Logo', help: 'PNG, JPEG or SVG, up to 1 MB. Shown on white.', accept: 'image/png,image/jpeg,image/svg+xml' },
  { slot: 'logoLight', label: 'Light logo (optional)', help: 'For dark backgrounds, such as the coloured header.', accept: 'image/png,image/jpeg,image/svg+xml' },
  { slot: 'banner', label: 'Banner (optional)', help: 'PNG or JPEG, up to 5 MB. About 1600 × 400 pixels works well.', accept: 'image/png,image/jpeg' },
  { slot: 'favicon', label: 'Browser tab icon (optional)', help: 'A square PNG, up to 256 KB.', accept: 'image/png' },
];

function ColourField({ label, description, value, fallback, check, onChange, error }: { label: string; description: string; value: string; fallback: string; check: typeof checkMainColour; onChange: (v: string) => void; error?: string }) {
  const result = value ? check(value) : null;
  return (
    <Stack gap={6}>
      <ColorInput label={label} description={description} placeholder={`Default: ${fallback}`} value={value} onChange={onChange} format="hex" swatches={[]} error={error ?? (result && !result.ok ? result.message : undefined)} />
      {result && !result.ok && result.suggestion ? (
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={() => onChange(result.suggestion!)} leftSection={<span style={{ width: 12, height: 12, borderRadius: 2, background: result.suggestion! }} />}>
            Use {result.suggestion}
          </Button>
        </Group>
      ) : null}
    </Stack>
  );
}

function Preview({ name, primary, accent, logo, logoLight, banner }: { name: string; primary: string; accent: string; logo: string | null; logoLight: string | null; banner: string | null }) {
  return (
    <Paper withBorder radius="md" style={{ overflow: 'hidden', borderColor: 'var(--em-line)' }} aria-label="Preview of the storefront">
      <Group px="md" h={56} justify="space-between" wrap="nowrap" style={{ background: primary, color: '#fff' }}>
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          {logoLight || logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={(logoLight ?? logo)!} alt="" style={{ height: 30, maxWidth: 120, objectFit: 'contain', background: logoLight ? 'transparent' : '#fff', borderRadius: 4, padding: logoLight ? 0 : 2 }} />
          ) : null}
          <Text fw={650} truncate>
            {name}
          </Text>
        </Group>
        <Text fz="xs">Sign out</Text>
      </Group>
      {banner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" style={{ display: 'block', width: '100%', height: 96, objectFit: 'cover' }} />
      ) : null}
      <Stack p="md" gap="sm" bg="#fff">
        <Group gap="xs">
          <Text fw={650}>Shell scheme furniture</Text>
          <Badge styles={{ root: { background: accent, color: DARK_TEXT } }}>Early-bird price</Badge>
        </Group>
        <Text fz="sm" c="dimmed">
          Order by 1 April for early-bird prices. <span style={{ color: primary, textDecoration: 'underline' }}>Ordering help</span>
        </Text>
        <Group>
          <Box component="span" px="md" py={8} style={{ background: primary, color: '#fff', borderRadius: 4, fontWeight: 600, fontSize: 14 }}>
            Add to basket
          </Box>
        </Group>
      </Stack>
    </Paper>
  );
}

export function BrandingEditor({ showId, showName, slug, platform, initial, images }: { showId: string; showName: string; slug: string; platform: { name: string; primary: string; accent: string }; initial: Values; images: Record<Slot, string | null> }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState<Slot | null>(null);
  const save = useAction(updateBrandingAction);
  const main = v.primaryColor ? checkMainColour(v.primaryColor) : null;
  const accent = v.accentColor ? checkAccentColour(v.accentColor) : null;
  // Until a new colour passes, the preview keeps the one saved (or the platform's).
  const saved = { primary: checkMainColour(initial.primaryColor), accent: checkAccentColour(initial.accentColor) };
  const previewPrimary = main?.ok ? main.colour : saved.primary.ok ? saved.primary.colour : platform.primary;
  const previewAccent = accent?.ok ? accent.colour : saved.accent.ok ? saved.accent.colour : platform.accent;

  async function upload(slot: Slot, file: File | null, remove = false) {
    if (!file && !remove) return;
    setBusy(slot);
    const form = new FormData();
    form.set('showId', showId);
    form.set('slot', slot);
    if (remove) form.set('remove', '1');
    if (file) form.set('file', file);
    const res = await brandingImageAction(form);
    setBusy(null);
    if (res.ok) {
      notifications.show({ color: 'green', message: remove ? 'Image removed.' : 'Image uploaded. The storefront shows it now.' });
      router.refresh();
    } else {
      notifications.show({ color: 'red', title: 'Not uploaded', message: res.error });
    }
  }

  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Stack gap="lg">
          <Panel title="Name and colours" description={`Leave anything blank to use the platform default (${platform.name}).`}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.run({ showId, ...v });
              }}
            >
              <Stack>
                <TextInput label="Marketplace name" description="In the header, the browser tab, emails and PDFs." placeholder={`${showName} Marketplace`} value={v.marketplaceName} onChange={(e) => setV({ ...v, marketplaceName: e.currentTarget.value })} maxLength={80} error={save.fieldErrors.marketplaceName} />
                <ColourField label="Main colour" description="Buttons, links and the header, with white text." value={v.primaryColor} fallback={platform.primary} check={checkMainColour} onChange={(c) => setV({ ...v, primaryColor: c })} error={save.fieldErrors.primaryColor} />
                <ColourField label="Accent colour" description="Highlights behind dark text, such as price labels." value={v.accentColor} fallback={platform.accent} check={checkAccentColour} onChange={(c) => setV({ ...v, accentColor: c })} error={save.fieldErrors.accentColor} />
                <TextInput label="Email sender name" description="Who emails seem to come from." placeholder={v.marketplaceName || platform.name} value={v.emailSenderName} onChange={(e) => setV({ ...v, emailSenderName: e.currentTarget.value })} maxLength={60} error={save.fieldErrors.emailSenderName} />
                <Group>
                  <Button type="submit" loading={save.pending} disabled={Boolean((main && !main.ok) || (accent && !accent.ok))}>
                    Save name and colours
                  </Button>
                </Group>
              </Stack>
            </form>
          </Panel>
          <Panel title="Images" description="Each upload shows straight away on the storefront.">
            <Stack gap="lg">
              {SLOTS.map((s) => (
                <Group key={s.slot} justify="space-between" align="center" wrap="nowrap" gap="md">
                  <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                    <Box w={88} h={56} style={{ border: '1px solid var(--em-line)', borderRadius: 6, display: 'grid', placeItems: 'center', background: s.slot === 'logoLight' ? previewPrimary : '#fff', overflow: 'hidden' }}>
                      {images[s.slot] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={images[s.slot]!} alt={`Current ${s.label.toLowerCase()}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      ) : (
                        <Text fz="xs" c={s.slot === 'logoLight' ? 'white' : 'dimmed'}>
                          None
                        </Text>
                      )}
                    </Box>
                    <div>
                      <Text fw={600} fz="sm">
                        {s.label}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {s.help}
                      </Text>
                    </div>
                  </Group>
                  <Group gap="xs">
                    <FileButton onChange={(f) => upload(s.slot, f)} accept={s.accept}>
                      {(props) => (
                        <Button {...props} size="xs" variant="default" leftSection={<IconUpload size={14} />} loading={busy === s.slot} aria-label={`Upload ${s.label.toLowerCase()}`}>
                          Upload
                        </Button>
                      )}
                    </FileButton>
                    {images[s.slot] ? (
                      <Button size="xs" variant="subtle" color="red" onClick={() => upload(s.slot, null, true)} disabled={busy === s.slot}>
                        Remove
                      </Button>
                    ) : null}
                  </Group>
                </Group>
              ))}
            </Stack>
          </Panel>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <div style={{ position: 'sticky', top: 76 }}>
          <Stack gap="xs">
            <Text fw={650}>Live preview</Text>
            <Preview name={v.marketplaceName || platform.name} primary={previewPrimary} accent={previewAccent} logo={images.logo} logoLight={images.logoLight} banner={images.banner} />
            <Text fz="xs" c="dimmed">
              Colours that are hard to read can’t be saved. The storefront is at /{slug}.
            </Text>
            {main && !main.ok ? <Alert color="orange">The preview keeps the current main colour until the new one passes the check.</Alert> : null}
          </Stack>
        </div>
      </Grid.Col>
    </Grid>
  );
}

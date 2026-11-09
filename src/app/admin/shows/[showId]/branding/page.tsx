import type { Metadata } from 'next';
import { fileUrl } from '@/server/services/files';
import { getPlatformBranding } from '@/server/services/settings';
import { loadShow } from '../load';
import { BrandingEditor } from './branding-editor';

export const metadata: Metadata = { title: 'Branding' };

export default async function BrandingPage({ params }: PageProps<'/admin/shows/[showId]/branding'>) {
  const { showId } = await params;
  const { show } = await loadShow(showId, 'show.branding.edit');
  const platform = await getPlatformBranding();
  const b = show.branding;
  return (
    <BrandingEditor
      showId={show.id}
      showName={show.name}
      slug={show.slug}
      platform={{ name: platform.marketplaceName, primary: platform.primaryColor, accent: platform.accentColor }}
      initial={{ marketplaceName: b.marketplaceName ?? '', primaryColor: b.primaryColor ?? '', accentColor: b.accentColor ?? '', emailSenderName: b.emailSenderName ?? '' }}
      images={{ logo: fileUrl(b.logoFileId), logoLight: fileUrl(b.logoLightFileId), banner: fileUrl(b.bannerFileId), favicon: fileUrl(b.faviconFileId) }}
    />
  );
}

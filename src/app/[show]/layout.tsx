import Link from 'next/link';
import type { Metadata } from 'next';
import { brandCss } from '@/lib/branding';
import { fileUrl } from '@/server/services/files';
import { getExhibitor } from '@/server/auth/current';
import { loadStorefront } from './load';
import { storefrontSignOutAction } from './actions';
import { basketCount } from '@/server/services/orders';
import styles from './storefront.module.css';

export async function generateMetadata({ params }: LayoutProps<'/[show]'>): Promise<Metadata> {
  const { show: slug } = await params;
  const { branding } = await loadStorefront(slug);
  const favicon = fileUrl(branding.faviconFileId);
  return { title: { default: branding.marketplaceName, template: `%s · ${branding.marketplaceName}` }, ...(favicon ? { icons: { icon: favicon } } : {}) };
}

/**
 * A show's branded storefront. Colours come only from checked, stored hex values, turned into CSS
 * variables here (DECISIONS.md, "Branding"); nothing an admin types reaches the page as CSS or HTML.
 */
export default async function StorefrontLayout({ children, params }: LayoutProps<'/[show]'>) {
  const { show: slug } = await params;
  const { show, branding } = await loadStorefront(slug);
  const exhibitor = await getExhibitor(show.id);
  const inBasket = exhibitor ? await basketCount(exhibitor) : 0;
  const light = fileUrl(branding.logoLightFileId);
  const logo = light ?? fileUrl(branding.logoFileId);
  return (
    <div className={styles.page}>
      <style>{brandCss(branding.primaryColor, branding.accentColor)}</style>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href={`/${show.slug}`} className={styles.brand}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className={`${styles.logo} ${light ? '' : styles.logoChip}`} />
            ) : null}
            <span className={styles.name}>{branding.marketplaceName}</span>
          </Link>
          <nav className={styles.headerLinks} aria-label="Storefront">
            {exhibitor ? (
              <>
                <Link className={styles.headerLink} href={`/${show.slug}/shop`}>
                  Order services
                </Link>
                <Link className={styles.headerLink} href={`/${show.slug}/basket`}>
                  Basket{inBasket ? ` (${inBasket})` : ''}
                </Link>
                <Link className={styles.headerLink} href={`/${show.slug}/orders`}>
                  Your orders
                </Link>
              </>
            ) : null}
            {show.helpEmail ? (
              <a className={styles.headerLink} href={`mailto:${show.helpEmail}`}>
                Help
              </a>
            ) : null}
            {exhibitor ? (
              <form action={storefrontSignOutAction}>
                <input type="hidden" name="slug" value={show.slug} />
                <button type="submit" className={styles.headerButton}>
                  Sign out
                </button>
              </form>
            ) : null}
          </nav>
        </div>
      </header>
      <main id="content" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        {show.name}
        {show.helpEmail ? ` · Questions? ${show.helpEmail}` : ''}
        {show.helpPhone ? ` · ${show.helpPhone}` : ''}
      </footer>
    </div>
  );
}

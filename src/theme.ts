import { Badge, ColorInput, Drawer, Modal, MultiSelect, Notification, Select, createTheme, type MantineColorsTuple } from '@mantine/core';

/**
 * The plain Event MarketPlace look, used by the admin and supplier panels and by any storefront
 * without its own branding. Storefronts recolour the primary colour with CSS variables built from
 * the show's checked colours (src/lib/branding.ts).
 *
 * Shade 6 of every colour reaches the WCAG AA contrast ratio (4.5:1) on white, so coloured text,
 * badges and filled buttons are readable. Palettes from BluePrint, with a deep green-teal of our own.
 */
const market: MantineColorsTuple = ['#e8f3f1', '#d1e7e3', '#a6d0c9', '#79b8ae', '#4f9f93', '#2b8476', '#0b5d57', '#094f4a', '#07413d', '#053330'];
const gray: MantineColorsTuple = ['#fafaf8', '#f4f3ef', '#ebe9e3', '#e1ded6', '#cfcbc1', '#ada99e', '#5f5c55', '#47453f', '#33312d', '#1c1b18'];
const red: MantineColorsTuple = ['#fff5f5', '#ffe3e3', '#ffc9c9', '#ffa8a8', '#ff8787', '#ff6b6b', '#c92a2a', '#b02525', '#962020', '#7d1a1a'];
const orange: MantineColorsTuple = ['#fff4e6', '#ffe8cc', '#ffd8a8', '#ffc078', '#ffa94d', '#ff922b', '#b43c0b', '#9c340a', '#842c08', '#6c2407'];
const green: MantineColorsTuple = ['#ebfbee', '#d3f9d8', '#b2f2bb', '#8ce99a', '#69db7c', '#51cf66', '#13773a', '#116832', '#0e592b', '#0c4a24'];
const blue: MantineColorsTuple = ['#e7f5ff', '#d0ebff', '#a5d8ff', '#74c0fc', '#4dabf7', '#339af0', '#1864ab', '#155897', '#124c83', '#0f406f'];
const yellow: MantineColorsTuple = ['#fff9db', '#fff3bf', '#ffec99', '#ffe066', '#ffd43b', '#fcc419', '#8a6100', '#785400', '#664700', '#543a00'];

const sans = "'Public Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export const theme = createTheme({
  primaryColor: 'market',
  primaryShade: 6,
  colors: { market, gray, red, orange, green, blue, yellow },
  black: '#1c1b18',
  fontFamily: sans,
  headings: { fontFamily: sans, fontWeight: '650' },
  radius: { xs: '2px', sm: '4px', md: '6px', lg: '10px', xl: '16px' },
  defaultRadius: 'sm',
  shadows: {
    xs: '0 1px 2px rgba(0, 0, 0, 0.04)',
    sm: '0 1px 3px rgba(0, 0, 0, 0.06)',
    md: '0 4px 16px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 32px rgba(0, 0, 0, 0.08)',
    xl: '0 10px 64px rgba(0, 0, 0, 0.12)',
  },
  cursorType: 'pointer',
  components: {
    Badge: Badge.extend({ defaultProps: { variant: 'light', radius: 'sm' }, styles: { root: { textTransform: 'none', letterSpacing: 0, fontWeight: 600 } } }),
    Notification: Notification.extend({ defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } }),
    Modal: Modal.extend({ defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } }),
    Drawer: Drawer.extend({ defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } }),
    Select: Select.extend({ defaultProps: { clearButtonProps: { 'aria-label': 'Clear' } } }),
    MultiSelect: MultiSelect.extend({ defaultProps: { clearButtonProps: { 'aria-label': 'Clear' } } }),
    // The colour picker's eye-dropper is an icon only, so it needs a name for screen readers.
    ColorInput: ColorInput.extend({ defaultProps: { eyeDropperButtonProps: { 'aria-label': 'Pick a colour from the screen' } } }),
  },
});

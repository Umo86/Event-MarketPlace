import type { ShowStatus } from '@/server/db/schema/shows';

export const STATUS_LABEL: Record<ShowStatus, string> = { draft: 'Draft', live: 'Live', closed: 'Closed', archived: 'Archived' };
export const STATUS_COLOUR: Record<ShowStatus, string> = { draft: 'gray', live: 'green', closed: 'orange', archived: 'gray' };
export const STATUS_HELP: Record<ShowStatus, string> = {
  draft: 'Only the show team can see it. Exhibitors can’t sign in yet.',
  live: 'Exhibitors on the list can sign in and order (between the ordering dates).',
  closed: 'Exhibitors can sign in to see their orders, but can’t order.',
  archived: 'The storefront is gone from the web. The records are kept.',
};

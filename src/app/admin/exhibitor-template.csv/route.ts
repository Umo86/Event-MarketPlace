import { getUserActorForApi } from '@/server/auth/current';
import { templateCsv } from '@/server/services/exhibitors';

/** A template for the exhibitor list, with the headings the upload recognises. */
export async function GET() {
  if (!(await getUserActorForApi())) return new Response('Not found', { status: 404 });
  return new Response(`﻿${templateCsv()}\r\n`, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="exhibitor-list-template.csv"', 'Cache-Control': 'private, no-store' },
  });
}

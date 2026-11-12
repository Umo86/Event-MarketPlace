import type { Metadata } from 'next';
import { Badge, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { Panel } from '@/components/ui/panel';
import { ProductEditor } from '@/components/catalogue/product-editor';
import { CommissionField } from '@/components/catalogue/commission-field';
import { can } from '@/server/authz';
import { defaultCommission, describeChange, editorProducts, showProducts } from '@/server/services/catalogue';
import { listCategories } from '@/server/services/categories';
import { commissionLabel, money, percentFromBps } from '@/lib/format';
import { loadShow } from '../load';
import { Approvals, type Waiting } from './approvals';

export const metadata: Metadata = { title: 'Products' };

const STATUS = { pending: ['Waiting for approval', 'yellow'], live: ['On sale', 'green'], rejected: ['Not approved', 'red'], archived: ['Off sale', 'gray'] } as const;

/**
 * Everything on sale at the show: approving suppliers' products and changes, commission, and
 * Media10's own services.
 */
export default async function ProductsPage({ params }: PageProps<'/admin/shows/[showId]/products'>) {
  const { showId } = await params;
  const { actor, show } = await loadShow(showId);
  const [{ products: rows, standTypes, waiting }, categories, canApprove, canCommission, canManage, platform] = await Promise.all([
    showProducts(actor, show.id),
    listCategories(actor, show.id),
    can(actor, 'products.approve', { showId }),
    can(actor, 'commission.manage', { showId }),
    can(actor, 'categories.manage', { showId }),
    defaultCommission(),
  ]);
  const waitingRows: Waiting[] = waiting.map(({ product: p, supplierName, categoryName }) => ({
    id: p.id,
    name: p.pendingChange?.name ?? p.name,
    supplierName,
    categoryName,
    kind: p.status === 'pending' ? 'new' : 'change',
    lines:
      p.status === 'pending'
        ? [`${money(p.pricePence)} before VAT (${percentFromBps(p.vatRateBps)} VAT)${p.earlyPricePence !== null ? `, early-bird ${money(p.earlyPricePence)}` : ''}${p.latePricePence !== null ? `, late ${money(p.latePricePence)}` : ''}`, ...(p.description ? [p.description] : [])]
        : describeChange(p, p.pendingChange!),
    imageFileId: p.pendingChange?.imageFileId ?? p.imageFileId,
  }));
  const organiserCats = categories.filter((c) => c.supplier?.kind === 'organiser');
  const organiserId = organiserCats[0]?.supplier?.id;
  const showFallback = `Use the platform default (${commissionLabel(platform.type, platform.value)})`;
  return (
    <Stack gap="lg">
      {canApprove ? (
        <Panel title={`Waiting for approval (${waitingRows.length})`} description="Exhibitors only see a new product, or a change to one, once you approve it. Orders already placed never change.">
          <Approvals showId={show.id} waiting={waitingRows} />
        </Panel>
      ) : null}
      {organiserId && canManage ? (
        <Panel title="Media10’s own services" description="These go on sale as soon as you save them. They’re charged on Media10’s own Stripe account.">
          <ProductEditor
            products={editorProducts(rows.filter((r) => r.supplierKind === 'organiser'))}
            categories={organiserCats.map((c) => ({ id: c.id, name: c.name }))}
            standTypes={standTypes}
            showId={show.id}
            supplierId={organiserId}
            via="organiser"
            canEdit
          />
        </Panel>
      ) : null}
      {canCommission ? (
        <Panel
          title="Commission"
          description="Media10’s fee on each line, worked out before VAT. The first one set is used: product, then category, then supplier (set by a super admin), then this show, then the platform default."
        >
          <CommissionField target={{ kind: 'show', showId: show.id, level: 'show' }} type={show.commissionType} value={show.commissionValue} label="This show" fallbackLabel={showFallback} />
          {categories
            .filter((c) => c.supplier?.kind !== 'organiser')
            .map((c) => (
              <CommissionField key={c.id} target={{ kind: 'show', showId: show.id, level: 'category', id: c.id }} type={c.commissionType} value={c.commissionValue} label={c.name} />
            ))}
        </Panel>
      ) : null}
      <Panel title="All products">
        {rows.length ? (
          <TableScrollContainer minWidth={760}>
            <Table verticalSpacing="sm" fz="sm">
              <TableThead>
                <TableTr>
                  <TableTh>Product</TableTh>
                  <TableTh>Supplier</TableTh>
                  <TableTh>Price before VAT</TableTh>
                  <TableTh>Status</TableTh>
                  <TableTh>Commission</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {rows.map(({ product: p, supplierName, categoryName, supplierKind }) => (
                  <TableTr key={p.id}>
                    <TableTd>
                      <Text fz="sm" fw={600}>
                        {p.name}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {categoryName}
                      </Text>
                    </TableTd>
                    <TableTd>{supplierName}</TableTd>
                    <TableTd>{money(p.pricePence)}</TableTd>
                    <TableTd>
                      <Badge color={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>
                    </TableTd>
                    <TableTd>
                      {supplierKind === 'organiser' ? (
                        <Text fz="xs" c="dimmed">
                          None: Media10’s own
                        </Text>
                      ) : canCommission ? (
                        <CommissionField target={{ kind: 'show', showId: show.id, level: 'product', id: p.id }} type={p.commissionType} value={p.commissionValue} label={`Commission on ${p.name}`} fallbackLabel="Use the category’s" />
                      ) : (
                        commissionLabel(p.commissionType, p.commissionValue)
                      )}
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        ) : (
          <Text fz="sm" c="dimmed">
            No products yet. Suppliers add theirs from their own panel once they’re assigned to a category on the Categories page.
          </Text>
        )}
      </Panel>
    </Stack>
  );
}

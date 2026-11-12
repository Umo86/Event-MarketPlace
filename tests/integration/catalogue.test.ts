import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { products, supplierUsers, suppliers } from '@/server/db/schema';
import { approveProduct, rejectProduct, saveProduct, setCommission, setProductArchived, showProducts, storefrontProducts, type ProductInput } from '@/server/services/catalogue';
import { createCategory } from '@/server/services/categories';
import { createOrganiserSupplier } from '@/server/services/suppliers';
import { setStorageForTests, MemoryStorage } from '@/server/storage';
import { allocate, commissionFor, priceFor, priceLine, resolveCommission, roundPence } from '@/lib/pricing';
import { actorFor, addStaff, exhibitorActor, makeShow, makeSupplier, makeUser } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
  setStorageForTests(new MemoryStorage());
});

describe('money maths', () => {
  it('rounds VAT half away from zero, once per line', () => {
    expect(roundPence(2.5)).toBe(3);
    expect(roundPence(-2.5)).toBe(-3);
    // 3 × £0.13 = 39p; VAT 7.8p → 8p (not 3 × 2.6p rounded separately).
    expect(priceLine({ unitPence: 13, quantity: 3, vatRateBps: 2000, commission: { type: 'percent', value: 1000 }, organiser: false })).toEqual({ netPence: 39, vatPence: 8, totalPence: 47, commissionPence: 4 });
    expect(priceLine({ unitPence: 1000, quantity: 1, vatRateBps: 2000, commission: { type: 'percent', value: 1000 }, organiser: true }).commissionPence).toBe(0);
  });

  it('takes the first commission that is set: product, category, supplier, show, platform', () => {
    expect(resolveCommission(null, { type: null, value: null }, { type: 'fixed', value: 250 }, { type: 'percent', value: 1000 })).toEqual({ type: 'fixed', value: 250 });
    expect(resolveCommission(undefined, null)).toEqual({ type: 'percent', value: 0 });
    expect(commissionFor(100, { type: 'fixed', value: 250 })).toBe(100);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('uses the early-bird and late prices by the show’s dates', () => {
    const now = new Date('2027-03-01T12:00:00Z');
    const p = { pricePence: 5000, earlyPricePence: 4000, latePricePence: 6000 };
    const show = { status: 'live' as const, orderingOpensAt: null, earlyBirdEndsAt: new Date('2027-03-10T00:00:00Z'), latePricesFrom: new Date('2027-04-01T00:00:00Z'), orderingClosesAt: null };
    expect(priceFor(p, show, now)).toEqual({ unitPence: 4000, band: 'early' });
    expect(priceFor(p, show, new Date('2027-03-20T00:00:00Z'))).toEqual({ unitPence: 5000, band: 'standard' });
    expect(priceFor(p, show, new Date('2027-04-02T00:00:00Z'))).toEqual({ unitPence: 6000, band: 'late' });
    expect(priceFor({ ...p, latePricePence: null }, show, new Date('2027-04-02T00:00:00Z')).band).toBe('standard');
  });
});

async function setup() {
  const show = await makeShow();
  const showAdmin = await addStaff(show.id, 'show_admin');
  const s = await makeSupplier();
  const db = await getDb();
  await db.update(suppliers).set({ stripeAccountId: `acct_test${s.supplier.id.slice(0, 8)}`, stripeChargesEnabled: true }).where(eq(suppliers.id, s.supplier.id));
  const cat = await createCategory(showAdmin, show.id, { name: 'Electrics', supplierId: s.supplier.id });
  return { show, showAdmin, ...s, cat };
}

const input = (categoryId: string, over: Partial<ProductInput> = {}): ProductInput => ({ categoryId, name: '500W socket', price: '45', earlyPrice: '', latePrice: '55.50', vatRateBps: 2000, stockLimit: '', standTypeKeys: [], ...over });

describe('products and price approval', () => {
  it('a new product waits for approval, then exhibitors see it at today’s price', async () => {
    const { show, showAdmin, supplier, owner, cat } = await setup();
    const p = await saveProduct(owner, { showId: show.id, supplierId: supplier.id, via: 'supplier' }, input(cat.id));
    expect(p).toMatchObject({ status: 'pending', pricePence: 4500, latePricePence: 5550 });
    const exhibitor = exhibitorActor(show.id, 'sam@example.com');
    expect(await storefrontProducts(exhibitor, show.id, 'shell_scheme')).toHaveLength(0);
    expect((await showProducts(showAdmin, show.id)).waiting).toHaveLength(1);
    await approveProduct(showAdmin, show.id, p.id);
    const seen = await storefrontProducts(exhibitor, show.id, 'shell_scheme');
    expect(seen).toMatchObject([{ name: '500W socket', unitPence: 4500, vatPence: 900, band: 'standard', supplierName: supplier.name }]);
  });

  it('a price change on a live product waits, while exhibitors keep the approved price', async () => {
    const { show, showAdmin, supplier, owner, cat } = await setup();
    const p = await saveProduct(owner, { showId: show.id, supplierId: supplier.id, via: 'supplier' }, input(cat.id));
    await approveProduct(showAdmin, show.id, p.id);
    const changed = await saveProduct(owner, { showId: show.id, supplierId: supplier.id, productId: p.id, via: 'supplier' }, input(cat.id, { price: '60', stockLimit: '10' }));
    expect(changed).toMatchObject({ status: 'live', pricePence: 4500, stockLimit: 10, pendingChange: expect.objectContaining({ pricePence: 6000 }) });
    const exhibitor = exhibitorActor(show.id, 'sam@example.com');
    expect((await storefrontProducts(exhibitor, show.id, null))[0]).toMatchObject({ unitPence: 4500, stockLeft: 10 });
    await expect(rejectProduct(showAdmin, show.id, p.id, '')).rejects.toThrow(/Say why/);
    await rejectProduct(showAdmin, show.id, p.id, 'Too steep for a socket');
    const db = await getDb();
    const [afterReject] = await db.select().from(products).where(eq(products.id, p.id));
    expect(afterReject).toMatchObject({ status: 'live', pricePence: 4500, pendingChange: null, rejectionReason: 'Too steep for a socket' });
    await saveProduct(owner, { showId: show.id, supplierId: supplier.id, productId: p.id, via: 'supplier' }, input(cat.id, { price: '50' }));
    await approveProduct(showAdmin, show.id, p.id);
    expect((await storefrontProducts(exhibitor, show.id, null))[0].unitPence).toBe(5000);
  });

  it('is only for the supplier’s own categories and people with the catalogue right', async () => {
    const { show, showAdmin, supplier, owner, cat } = await setup();
    const other = await makeSupplier();
    const otherCat = await createCategory(showAdmin, show.id, { name: 'Carpet', supplierId: other.supplier.id });
    await expect(saveProduct(owner, { showId: show.id, supplierId: supplier.id, via: 'supplier' }, input(otherCat.id))).rejects.toMatchObject({ fieldErrors: { categoryId: expect.any(String) } });
    await expect(saveProduct(other.owner, { showId: show.id, supplierId: supplier.id, via: 'supplier' }, input(cat.id))).rejects.toMatchObject({ code: 'not_found' });
    const staff = await makeUser();
    const db = await getDb();
    await db.insert(supplierUsers).values({ supplierId: supplier.id, userId: staff.id, role: 'staff', canEditCatalogue: false });
    await expect(saveProduct(actorFor(staff), { showId: show.id, supplierId: supplier.id, via: 'supplier' }, input(cat.id))).rejects.toMatchObject({ code: 'forbidden' });
    await db.update(supplierUsers).set({ canEditCatalogue: true }).where(eq(supplierUsers.userId, staff.id));
    await expect(saveProduct(actorFor(staff), { showId: show.id, supplierId: supplier.id, via: 'supplier' }, input(cat.id))).resolves.toMatchObject({ status: 'pending' });
    // Suppliers never approve their own.
    const p = (await db.select().from(products).where(eq(products.supplierId, supplier.id)))[0];
    await expect(approveProduct(owner, show.id, p.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(setCommission(owner, show.id, { level: 'product', id: p.id }, { type: 'percent', value: '0' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('shows products only to the stand types chosen, and takes them off sale at once', async () => {
    const { show, showAdmin, supplier, owner, cat } = await setup();
    const p = await saveProduct(owner, { showId: show.id, supplierId: supplier.id, via: 'supplier' }, input(cat.id, { standTypeKeys: ['space_only'] }));
    await expect(saveProduct(owner, { showId: show.id, supplierId: supplier.id, via: 'supplier' }, input(cat.id, { standTypeKeys: ['nonsense'] }))).rejects.toMatchObject({ fieldErrors: { standTypeKeys: expect.any(String) } });
    await approveProduct(showAdmin, show.id, p.id);
    const exhibitor = exhibitorActor(show.id, 'sam@example.com');
    expect(await storefrontProducts(exhibitor, show.id, 'shell_scheme')).toHaveLength(0);
    expect(await storefrontProducts(exhibitor, show.id, 'space_only')).toHaveLength(1);
    await setProductArchived(owner, { showId: show.id, supplierId: supplier.id, productId: p.id, via: 'supplier' }, true);
    expect(await storefrontProducts(exhibitor, show.id, 'space_only')).toHaveLength(0);
    await setProductArchived(owner, { showId: show.id, supplierId: supplier.id, productId: p.id, via: 'supplier' }, false);
    expect(await storefrontProducts(exhibitor, show.id, 'space_only')).toHaveLength(1);
  });

  it('Media10’s own services are looked after by show admins and go live at once', async () => {
    const { show, showAdmin, admin } = await setup();
    const db = await getDb();
    const [existing] = await db.select().from(suppliers).where(eq(suppliers.kind, 'organiser'));
    const organiser = existing ?? (await createOrganiserSupplier(admin, { name: 'Media10 Ltd', contactName: 'Ops', email: 'ops@media10.example.com', vatRegistered: true, invoicePrefix: 'MTN' }));
    const cleaning = await createCategory(showAdmin, show.id, { name: 'Stand cleaning', supplierId: organiser.id });
    const p = await saveProduct(showAdmin, { showId: show.id, supplierId: organiser.id, via: 'organiser' }, input(cleaning.id, { name: 'Nightly clean', price: '30', latePrice: '' }));
    expect(p.status).toBe('live');
    expect((await storefrontProducts(exhibitorActor(show.id, 'sam@example.com'), show.id, null)).map((x) => x.name)).toContain('Nightly clean');
  });
});

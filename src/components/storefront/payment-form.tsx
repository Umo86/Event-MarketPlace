'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { completePaymentAction, simulatePaymentAction, startPaymentAction } from '@/app/[show]/shop-actions';

type Started = { mode: 'stripe' | 'simulator'; clientSecret: string | null; publishableKey: string | null };

function CardForm({ slug, orderId, totalText }: { slug: string; orderId: string; totalText: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    // Saves the card (with 3D Secure if the bank asks), then each supplier is charged on our side.
    const { error: err, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}/${slug}/orders/${orderId}/pay/return` },
    });
    if (err) {
      setBusy(false);
      setError(err.message ?? 'Your card couldn’t be used. Check the details or try another card.');
      return;
    }
    const res = await completePaymentAction({ slug, orderId, setupIntentId: setupIntent?.id ?? '' });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/${slug}/orders/${orderId}`);
    router.refresh();
  }
  return (
    <form onSubmit={pay}>
      <Stack gap="md">
        <PaymentElement options={{ layout: 'tabs' }} />
        {error ? <Alert color="red">{error}</Alert> : null}
        <Group>
          <Button type="submit" size="md" loading={busy} disabled={!stripe}>
            Pay {totalText}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function Simulator({ slug, orderId, suppliers, totalText }: { slug: string; orderId: string; suppliers: { id: string; name: string }[]; totalText: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function pay(declineSupplierId: string | null) {
    setBusy(declineSupplierId ?? 'ok');
    const res = await simulatePaymentAction({ slug, orderId, declineSupplierId });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    router.push(`/${slug}/orders/${orderId}`);
    router.refresh();
  }
  return (
    <Stack gap="md">
      <Alert color="orange" title="Payment simulator">
        This stands in for the card form on a developer’s computer. No money moves.
      </Alert>
      {error ? <Alert color="red">{error}</Alert> : null}
      <Group>
        <Button size="md" onClick={() => pay(null)} loading={busy === 'ok'}>
          Pay {totalText} with a test card
        </Button>
      </Group>
      {suppliers.length > 1 ? (
        <Group gap="xs">
          {suppliers.map((s) => (
            <Button key={s.id} size="xs" variant="default" onClick={() => pay(s.id)} loading={busy === s.id}>
              Test card that {s.name} declines
            </Button>
          ))}
        </Group>
      ) : null}
    </Stack>
  );
}

/** Asks the server to start paying (which re-checks stock), then shows Stripe's card form or the simulator. */
export function PaymentForm({ slug, orderId, totalText, suppliers }: { slug: string; orderId: string; totalText: string; suppliers: { id: string; name: string }[] }) {
  const [started, setStarted] = useState<Started | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    startPaymentAction({ slug, orderId }).then((res) => {
      if (!live) return;
      if (res.ok && res.data) setStarted(res.data);
      else setError(res.ok ? 'Something went wrong.' : res.error);
    });
    return () => {
      live = false;
    };
  }, [slug, orderId]);
  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => (started?.mode === 'stripe' && started.publishableKey ? loadStripe(started.publishableKey) : null), [started]);
  if (error) return <Alert color="red">{error}</Alert>;
  if (!started)
    return (
      <Group gap="xs">
        <Loader size="sm" />
        <Text fz="sm">Getting the payment ready…</Text>
      </Group>
    );
  if (started.mode === 'simulator') return <Simulator slug={slug} orderId={orderId} suppliers={suppliers} totalText={totalText} />;
  if (!stripePromise || !started.clientSecret) return <Alert color="red">Card payments aren’t set up properly yet. Contact the show team.</Alert>;
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: started.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: getComputedStyle(document.documentElement).getPropertyValue('--brand-main').trim() || undefined } } }}>
      <CardForm slug={slug} orderId={orderId} totalText={totalText} />
    </Elements>
  );
}

/** After a bank's 3D Secure page sends the person back: finish the payment, then show the order. */
export function FinishAfterRedirect({ slug, orderId, setupIntentId }: { slug: string; orderId: string; setupIntentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    completePaymentAction({ slug, orderId, setupIntentId }).then((res) => {
      if (res.ok) {
        router.replace(`/${slug}/orders/${orderId}`);
        router.refresh();
      } else setError(res.error);
    });
  }, [slug, orderId, setupIntentId, router]);
  if (error) return <Alert color="red">{error}</Alert>;
  return (
    <Group gap="xs">
      <Loader size="sm" />
      <Text fz="sm">Finishing your payment…</Text>
    </Group>
  );
}

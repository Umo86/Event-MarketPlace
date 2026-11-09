'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group, Stack, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { slugify } from '@/lib/slug';
import { createShowAction } from '../../actions';

export function NewShowForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [venue, setVenue] = useState('');
  const create = useAction(createShowAction, { onSuccess: (d) => d && router.push(`/admin/shows/${d.id}/branding`) });
  const shownSlug = slugTouched ? slug : slugify(name);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.run({ name, slug: shownSlug, venue });
      }}
    >
      <Stack maw={560}>
        <TextInput label="Show name" description="As exhibitors know it, with the city and year." placeholder="UK Construction Week London 2027" required value={name} onChange={(e) => setName(e.currentTarget.value)} error={create.fieldErrors.name} />
        <TextInput
          label="Web address"
          description="The storefront lives at this address. Lower case letters, numbers and hyphens."
          leftSection="/"
          value={shownSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.currentTarget.value.toLowerCase());
          }}
          error={create.fieldErrors.slug}
        />
        <TextInput label="Venue (optional)" placeholder="ExCeL London" value={venue} onChange={(e) => setVenue(e.currentTarget.value)} />
        <Group>
          <Button type="submit" loading={create.pending}>
            Create show
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

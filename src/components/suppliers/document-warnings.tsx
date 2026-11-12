import { Alert, List, ListItem, Text } from '@mantine/core';

/** The warning at the top of a supplier's pages when a document expires soon or has expired. Server component. */
export function DocumentWarnings({ warnings, who }: { warnings: { id: string; title: string; state: string; expiry: string }[]; who: 'you' | 'they' }) {
  if (!warnings.length) return null;
  const expired = warnings.some((w) => w.state === 'expired');
  return (
    <Alert color={expired ? 'red' : 'yellow'} title={expired ? 'A document has expired' : 'A document expires soon'} mb="lg" data-testid="document-warning">
      <List fz="sm" spacing={2}>
        {warnings.map((w) => (
          <ListItem key={w.id}>
            {w.title}: {w.expiry.toLowerCase()}.
          </ListItem>
        ))}
      </List>
      <Text fz="sm" mt={6}>
        {who === 'you' ? 'Upload the renewed document so the show teams have a current copy.' : 'Ask them to upload the renewed document.'}
      </Text>
    </Alert>
  );
}

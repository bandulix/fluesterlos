type Client = { write: (chunk: string) => void; close: () => void };

const channels = new Map<string, Set<Client>>();

export function subscribe(code: string, client: Client) {
  const key = code.toLowerCase();
  if (!channels.has(key)) channels.set(key, new Set());
  channels.get(key)!.add(client);
  return () => {
    channels.get(key)?.delete(client);
  };
}

export function publish(code: string, event: string, data: unknown) {
  const key = code.toLowerCase();
  const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
  const set = channels.get(key);
  if (!set) return;
  for (const client of set) {
    try { client.write(payload); } catch { /* ignore */ }
  }
}

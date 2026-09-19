import type { Message } from '../lib/service';

export function uniqueRecords<T extends { id: string }>(items: readonly T[]): T[] {
  const records = new Map<string, T>();
  for (const item of items) if (!records.has(item.id)) records.set(item.id, item);
  return [...records.values()];
}

export function chronologicalMessages(pages: readonly { items: Message[] }[]): Message[] {
  // The most recent page wins when an insert/refetch overlaps an older cursor page.
  const recent = new Map(uniqueRecords(pages.flatMap((page) => page.items)).map((message) => [message.id, message]));
  return uniqueRecords([...pages].reverse().flatMap((page) => page.items)).map((message) => recent.get(message.id)!);
}

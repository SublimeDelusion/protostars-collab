export const severities = ["high", "medium", "low"] as const;
export type Severity = typeof severities[number];
export type Kind = "problem" | "idea" | "inspiration" | "enhancement" | "comment" | "test" | "vote" | "resolution" | "completion";
export type Entry = { id: string; kind: Kind; parent: string | null; title: string; body: string; author: string; source?: string; created: string; starred?: boolean; active?: boolean; severity?: Severity };
export type Todo = { ideaId: string; done: boolean; created: string; assignee?: string | null };
export type TeamInfo = { number: string; name: string; logo: string };

export function withoutEntryBranches<T extends { id: string; parent: string | null }>(entries: T[], removedIds: Iterable<string>) {
  const removed = new Set(removedIds);
  const children = new Map<string, string[]>();
  for (const { id, parent } of entries) {
    if (parent) {
      const siblings = children.get(parent) ?? [];
      siblings.push(id);
      children.set(parent, siblings);
    }
  }
  for (const id of removed) {
    for (const child of children.get(id) ?? []) removed.add(child);
  }
  return entries.filter(entry => !removed.has(entry.id));
}

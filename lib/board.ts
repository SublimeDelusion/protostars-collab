export const severities = ["high", "medium", "low"] as const;
export const enhancementOutcomes = ["done", "wont-fix"] as const;
export const enhancementOutcomeLabels = { done: "Done", "wont-fix": "Won’t fix" };
export type Severity = typeof severities[number];
export type Kind = "problem" | "idea" | "inspiration" | "enhancement" | "comment" | "test" | "vote" | "resolution" | "completion" | "priority-change" | "reopened";
export type Entry = { id: string; kind: Kind; parent: string | null; title: string; body: string; author: string; source?: string; ownerTeam?: string; created: string; starred?: boolean; active?: boolean; severity?: Severity };
export type Todo = { ideaId: string; done: boolean; inProgress?: boolean; rank?: number | null; created: string; assignee?: string | null };
export type TeamInfo = { number: string; name: string; logo: string };
export type AdoptionRow = { number: string; name: string; invitedBy: string | null; claimed: boolean; problems: number; inspirations: number; tasks: number };

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

export const taskStatuses = ["todo", "in-progress", "done"] as const;
export type TaskStatus = typeof taskStatuses[number];
export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "To-do",
  "in-progress": "In progress",
  done: "Done",
};

export function taskStatus(todo: Todo): TaskStatus {
  if (todo.done) return "done";
  return todo.inProgress ? "in-progress" : "todo";
}

export function compareTaskRank(a: Todo, b: Todo) {
  return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
    || a.created.localeCompare(b.created) || a.ideaId.localeCompare(b.ideaId);
}

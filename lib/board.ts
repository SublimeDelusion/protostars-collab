export const severities = ["high", "medium", "low"] as const;
export type Severity = typeof severities[number];
export type Kind = "problem" | "idea" | "inspiration" | "comment" | "test" | "vote" | "resolution" | "completion";
export type Entry = { id: string; kind: Kind; parent: string | null; title: string; body: string; author: string; created: string; starred?: boolean; active?: boolean; severity?: Severity };
export type Todo = { ideaId: string; done: boolean; created: string; assignee?: string | null };

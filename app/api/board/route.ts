import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { contributions, people, todos } from "../../../db/schema";
import { PAGES_ORIGIN } from "../../../lib/pages-origin";
import { DEFAULT_TEAM, teamFor, teamInfo, teamSeed } from "../../../lib/teams";
import { NAME_COOKIE, boardCookie, displayName, displayNameKey, normalizeDisplayName } from "../../../lib/board-cookies";
import { compareTaskRank, enhancementOutcomes, severities, taskStatus, taskStatuses, withoutEntryBranches, type Entry, type Kind, type Severity } from "../../../lib/board";

const editableKinds = ["problem", "idea", "inspiration", "enhancement"];
const trim = (value: unknown) => typeof value === "string" ? value.trim() : "";
const validSeverity = (value: unknown): value is Severity => severities.some(severity => severity === value);
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

// Keep the original row so deleting a seeded entry also survives restarts and redeploys.
const deletionKind = "deletion";
const deletionId = (id: string) => "deleted:" + id;
const retiredSeedIds = (number: string) => number === DEFAULT_TEAM ? ["rails", "auto-2", "auto-3"] : [];

function publicEntry(row: typeof contributions.$inferSelect | Entry, source?: string): Entry {
  const { id, kind, parent, title, body, author, created } = row;
  const starred = "starVoter" in row ? row.starVoter !== null : row.starred === true;
  const active = "outcomeFor" in row ? row.outcomeFor !== null : row.active === true;
  return { id, kind: kind as Kind, parent, title, body, author: source ?? author, created, ...(source ? { source } : {}), ...(starred ? { starred: true } : {}),
    ...(kind === "resolution" || kind === "completion" ? { active } : {}),
    ...(kind === "problem" ? { severity: row.severity ?? "medium" } : {}) };
}

export async function GET(request: Request) {
  const team = teamFor(request);
  const number = team.number;
  const db = getDb();
  const [rows, tasks, roster] = await Promise.all([
    db.select().from(contributions).where(eq(contributions.team, number)).orderBy(asc(contributions.created), asc(contributions.id)),
    db.select().from(todos).where(eq(todos.team, number)).orderBy(asc(todos.created), asc(todos.ideaId)),
    db.select().from(people).where(eq(people.team, number)),
  ]);
  const seeds = teamSeed(number);
  const seedSources = new Map(seeds.map(entry => [entry.id, entry.source]));
  const hidden = [...retiredSeedIds(number), ...rows.flatMap(row => row.kind === deletionKind && row.parent ? [row.parent] : [])];
  const allEntries = new Map([...seeds, ...rows.filter(row => row.kind !== deletionKind)].map(entry => [entry.id, entry]));
  const normalized = [...allEntries.values()].map(entry => {
    const parent = entry.parent ? allEntries.get(entry.parent) : undefined;
    // Earlier resolutions were recorded under the chosen idea.
    return entry.kind === "resolution" && parent?.kind === "idea" ? { ...entry, parent: parent.parent } : entry;
  });
  const rosterByKey = new Map(roster.map(person => [person.key, person]));
  const currentName = (value: string) => {
    const person = rosterByKey.get(displayNameKey(value));
    return (person?.renamedTo ? rosterByKey.get(person.renamedTo)?.name : person?.name) ?? value;
  };
  const visible = withoutEntryBranches(normalized, hidden).map(entry => ({ ...entry, author: currentName(entry.author) }));
  const byId = new Map(visible.map(entry => [entry.id, publicEntry(entry, seedSources.get(entry.id))]));
  const previousName = displayName(request);
  const name = currentName(previousName);
  const key = displayNameKey(name);
  const ownCommentIds = key ? visible.filter(row => row.kind === "comment" && displayNameKey(row.author) === key).map(row => row.id) : [];
  const names = new Map(rows.filter(row => row.kind !== deletionKind && row.author !== "Competition debrief").map(row => {
    const author = currentName(row.author);
    return [displayNameKey(author), author];
  }));
  for (const person of roster) if (!person.renamedTo) names.set(person.key, person.name);
  if (key && key !== "competition debrief" && !names.has(key)) {
    await db.insert(people).values({ team: number, key, name }).onConflictDoNothing();
    names.set(key, name);
  }
  const knownNames = [...names.values()].sort((a, b) => a.localeCompare(b));
  const result = response({ version: 1, team: number, teamInfo: teamInfo(team), entries: [...byId.values()], displayName: name, ownCommentIds, knownNames,
    todos: tasks.filter(task => byId.get(task.ideaId)?.kind === "idea").map(task => ({ ...task, assignee: task.assignee && currentName(task.assignee) })) });
  if (name !== previousName) result.headers.set("Set-Cookie", boardCookie(NAME_COOKIE, name));
  return result;
}

async function readInput(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return response({ error: "Use JSON." }, 415);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && origin !== PAGES_ORIGIN) return response({ error: "Origin does not match." }, 403);
  const raw = await request.text();
  if (raw.length > 16000) return response({ error: "This contribution is too long." }, 413);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return response({ error: "Invalid JSON." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return response({ error: "Invalid contribution." }, 400);
  return input as Record<string, unknown>;
}

async function canonicalName(db: ReturnType<typeof getDb>, number: string, value: string) {
  const key = displayNameKey(value);
  const person = await findPerson(db, number, key);
  if (person) return person.renamedTo ? undefined : person.name;
  const rows = await db.selectDistinct({ author: contributions.author }).from(contributions).where(and(eq(contributions.team, number), ne(contributions.kind, deletionKind)));
  return rows.find(row => row.author !== "Competition debrief" && displayNameKey(row.author) === key)?.author;
}

async function findPerson(db: ReturnType<typeof getDb>, team: string, key: string) {
  const [person] = await db.select().from(people).where(and(eq(people.team, team), eq(people.key, key))).limit(1);
  return person;
}

async function currentDisplayName(db: ReturnType<typeof getDb>, team: string, value: string) {
  if (!value) return "";
  const person = await findPerson(db, team, displayNameKey(value));
  if (!person?.renamedTo) return person?.name ?? value;
  return (await findPerson(db, team, person.renamedTo))?.name ?? "";
}

async function renamePerson(db: ReturnType<typeof getDb>, team: string, previous: string, name: string) {
  const oldKey = displayNameKey(previous);
  const key = displayNameKey(name);
  const oldPerson = await findPerson(db, team, oldKey);
  if (!oldPerson || oldPerson.renamedTo) return response({ error: "Set your display name on this device first." }, 422);
  if (key !== oldKey && (await findPerson(db, team, key) || await canonicalName(db, team, name))) {
    return response({ error: "That name is already in use. Try a nickname." }, 409);
  }

  const [authors, assignments] = await Promise.all([
    db.selectDistinct({ value: contributions.author }).from(contributions).where(eq(contributions.team, team)),
    db.selectDistinct({ value: todos.assignee }).from(todos).where(eq(todos.team, team)),
  ]);
  const oldValues = (rows: { value: string | null }[]) => rows.flatMap(({ value }) =>
    value && displayNameKey(value) === oldKey ? [value] : []);
  const oldAuthors = oldValues(authors);
  const oldAssignments = oldValues(assignments);
  const oldRow = and(eq(people.team, team), eq(people.key, oldKey), isNull(people.renamedTo));
  const rosterChanges = key === oldKey
    ? [db.update(people).set({ name }).where(oldRow)]
    : [
      db.delete(people).where(oldRow),
      db.insert(people).values({ team, key: oldKey, name: oldPerson.name, renamedTo: key }),
      db.insert(people).values({ team, key, name }),
      db.update(people).set({ renamedTo: key }).where(and(eq(people.team, team), eq(people.renamedTo, oldKey))),
    ];
  const updates = [
    ...rosterChanges,
    db.update(contributions).set({ starVoter: key }).where(and(eq(contributions.team, team), eq(contributions.starVoter, oldKey))),
  ];
  try {
    await db.batch([updates[0]!, ...updates.slice(1),
      ...oldAuthors.map(author => db.update(contributions).set({ author: name }).where(and(eq(contributions.team, team), eq(contributions.author, author)))),
      ...oldAssignments.map(assignee => db.update(todos).set({ assignee: name }).where(and(eq(todos.team, team), eq(todos.assignee, assignee)))),
    ]);
  } catch (error) {
    if (key !== oldKey && (await findPerson(db, team, key) || (await findPerson(db, team, oldKey))?.renamedTo)) {
      return response({ error: "The name changed while you were editing. Refresh and try again." }, 409);
    }
    throw error;
  }
  const comments = await db.select({ id: contributions.id }).from(contributions)
    .where(and(eq(contributions.team, team), eq(contributions.kind, "comment"), eq(contributions.author, name)));
  const result = response({ displayName: name, ownCommentIds: comments.map(comment => comment.id) });
  result.headers.set("Set-Cookie", boardCookie(NAME_COOKIE, name));
  return result;
}

async function findEntry(db: ReturnType<typeof getDb>, number: string, id: string): Promise<typeof contributions.$inferSelect | Entry | undefined> {
  if (id.length > 80 || id.startsWith("deleted:") || retiredSeedIds(number).includes(id)) return undefined;
  const rows = await db.select().from(contributions).where(and(eq(contributions.team, number), inArray(contributions.id, [id, deletionId(id)])));
  if (rows.some(row => row.kind === deletionKind)) return undefined;
  const entry = rows[0] ?? teamSeed(number).find(item => item.id === id);
  if (entry?.parent && !await findEntry(db, number, entry.parent)) return undefined;
  return entry;
}

export async function POST(request: Request) {
  const { number } = teamFor(request);
  const input = await readInput(request);
  if (input instanceof Response) return input;
  const db = getDb();
  if (input.action === "set-display-name" || input.action === "rename-display-name") {
    const proposed = normalizeDisplayName(trim(input.author));
    if (!proposed || proposed.length > 50 || displayNameKey(proposed) === "competition debrief") {
      return response({ error: "Enter a display name between 1 and 50 characters." }, 400);
    }
    if (input.action === "rename-display-name") {
      const current = await currentDisplayName(db, number, displayName(request));
      if (!current) return response({ error: "Set your display name on this device first." }, 422);
      return renamePerson(db, number, current, proposed);
    }
    if ((await findPerson(db, number, displayNameKey(proposed)))?.renamedTo) {
      return response({ error: "That name is unavailable. Choose a different display name." }, 409);
    }
    const match = await canonicalName(db, number, proposed);
    if (match && input.confirmExisting !== true) {
      return response({ error: "Confirm the existing name or choose a different one." }, 409);
    }
    if (!match && input.confirmExisting === true) {
      return response({ error: "This name could not be found." }, 404);
    }
    const name = match ?? proposed;
    await db.insert(people).values({ team: number, key: displayNameKey(name), name }).onConflictDoNothing();
    const comments = match ? await db.select({ id: contributions.id, author: contributions.author }).from(contributions).where(and(eq(contributions.team, number), eq(contributions.kind, "comment"))) : [];
    const ownCommentIds = comments.filter(row => displayNameKey(row.author) === displayNameKey(name)).map(row => row.id);
    const result = response({ displayName: name, ownCommentIds });
    result.headers.set("Set-Cookie", boardCookie(NAME_COOKIE, name));
    return result;
  }
  const kind = input.kind as Kind;
  const untitled = ["comment", "test", "vote", "resolution"].includes(kind);
  const noNote = kind === "vote";
  if (!untitled && !editableKinds.includes(kind)) return response({ error: "Unknown contribution type." }, 400);
  if (input.starred === true && kind !== "comment") return response({ error: "A star needs a comment on a problem idea." }, 400);

  const remembered = await currentDisplayName(db, number, displayName(request));
  const author = remembered || normalizeDisplayName(trim(input.author));
  if (!author) return response({ error: "Enter a display name for your first post." }, 422);
  if (!remembered && (displayNameKey(author) === "competition debrief" || await findPerson(db, number, displayNameKey(author)) || await canonicalName(db, number, author))) {
    return response({ error: "Confirm the existing name or choose a different one." }, 409);
  }
  if (input.severity !== undefined && (kind !== "problem" || !validSeverity(input.severity))) {
    return response({ error: "Choose High, Medium or Low severity." }, 400);
  }
  const severity = kind === "problem" && validSeverity(input.severity) ? input.severity : null;
  const enhancementOutcome = enhancementOutcomes.find(value => value === input.outcome);
  const closesEnhancement = kind === "resolution" && enhancementOutcome !== undefined;
  const title = closesEnhancement ? enhancementOutcome : untitled ? "" : trim(input.title);
  const body = noNote ? "" : trim(input.body);
  if (author.length > 50 || (!untitled && !title) || title.length > 120 || (!noNote && !closesEnhancement && !body) || body.length > 3000) {
    return response({ error: "Check the name, title and required note." }, 400);
  }

  const parent = untitled || kind === "idea" ? trim(input.parent) : null;
  const target = parent ? await findEntry(db, number, parent) : undefined;
  const container = target?.kind === "idea" && target.parent ? await findEntry(db, number, target.parent) : undefined;
  const problemIdea = container?.kind === "problem";
  const inspirationIdea = container?.kind === "inspiration";
  const parentIsValid = kind === "idea" ? target?.kind === "problem" || target?.kind === "inspiration"
    : kind === "comment" ? input.starred === true ? problemIdea : problemIdea || inspirationIdea || target?.kind === "inspiration" || target?.kind === "enhancement"
    : kind === "vote" ? inspirationIdea || target?.kind === "enhancement"
    : kind === "test" ? problemIdea
    : kind === "resolution" ? closesEnhancement ? target?.kind === "enhancement" : target?.kind === "problem"
    : true;
  if (!parentIsValid) return response({ error: "This action is unavailable for that entry." }, 404);

  const starred = kind === "vote" || input.starred === true;
  const outcomeFor = kind === "resolution" ? target?.id : null;
  const entry: Entry = { id: crypto.randomUUID(), kind, parent, title, body, author, created: new Date().toISOString() };
  const [saved] = await db.insert(contributions)
    .values({ ...entry, team: number, severity, outcomeFor, starVoter: starred ? displayNameKey(author) : null })
    .onConflictDoNothing()
    .returning();
  if (!saved) return response({ error: starred ? "You’ve already starred this item." : outcomeFor ? "This request or problem is already closed." : "Could not save. Please try again." }, 409);
  if (!remembered) await db.insert(people).values({ team: number, key: displayNameKey(author), name: author }).onConflictDoNothing();
  const result = response({ entry: publicEntry(saved) }, 201);
  if (author !== displayName(request)) result.headers.set("Set-Cookie", boardCookie(NAME_COOKIE, author));
  return result;
}

export async function PATCH(request: Request) {
  const { number } = teamFor(request);
  const input = await readInput(request);
  if (input instanceof Response) return input;
  const id = trim(input.id);
  const title = trim(input.title);
  const body = trim(input.body);
  if (input.action === "delete-entry") {
    if (input.confirmation !== "delete") return response({ error: "Type delete to confirm." }, 400);
    const db = getDb();
    const entry = id ? await findEntry(db, number, id) : undefined;
    if (!entry) return response({ deletedId: id });
    const author = await currentDisplayName(db, number, displayName(request));
    const name = displayNameKey(author);
    if (entry.kind === "comment" ? !name || name !== displayNameKey(await currentDisplayName(db, number, entry.author)) : !editableKinds.includes(entry.kind)) {
      return response({ error: "You can’t delete this entry." }, 403);
    }
    await db.insert(contributions).values({
      id: deletionId(id), team: number, kind: deletionKind, parent: id, title: "", body: "",
      author, created: new Date().toISOString(),
    }).onConflictDoNothing();
    return response({ deletedId: id });
  }
  if (input.action === "add-todo" || input.action === "set-todo-done" || input.action === "set-todo-status" || input.action === "move-todo" || input.action === "set-todo-assignee") {
    if (input.action === "set-todo-done" && typeof input.done !== "boolean") {
      return response({ error: "Choose whether the to-do is done." }, 400);
    }
    if ((input.action === "set-todo-status" || input.action === "move-todo") && !taskStatuses.some(status => status === input.status)) {
      return response({ error: "Choose a valid task status." }, 400);
    }
    const status = input.action === "set-todo-done" ? (input.done ? "done" : "todo") : input.status;
    const db = getDb();
    const idea = id ? await findEntry(db, number, id) : undefined;
    const parent = idea?.kind === "idea" && idea.parent ? await findEntry(db, number, idea.parent) : undefined;
    if (parent?.kind !== "problem" && parent?.kind !== "inspiration") {
      return response({ error: "This idea could not be found." }, 404);
    }
    let assignee: string | null = null;
    if (input.action !== "set-todo-done" && input.action !== "set-todo-status" && input.assignee != null) {
      if (typeof input.assignee !== "string" || input.assignee.length > 50) {
        return response({ error: "Choose an assignee from the team list." }, 400);
      }
      if (trim(input.assignee)) {
        assignee = (await canonicalName(db, number, input.assignee)) ?? null;
        if (!assignee) return response({ error: "Choose an assignee from the team list." }, 400);
      }
    }
    if (input.action === "move-todo") {
      const tasks = await db.select().from(todos).where(eq(todos.team, number));
      const moving = tasks.find(task => task.ideaId === id);
      if (!moving) return response({ error: "Add this idea to the to-do list first." }, 404);
      const ordered = tasks.filter(task => task.ideaId !== id && taskStatus(task) === status).sort(compareTaskRank);
      const destinationAssignee = input.assignee === undefined ? moving.assignee : assignee;
      const before = trim(input.before);
      const index = before ? ordered.findIndex(task => task.ideaId === before && (input.assignee === undefined || task.assignee === destinationAssignee)) : ordered.length;
      if (index < 0) return response({ error: "The target task moved. Refresh and try again." }, 409);
      ordered.splice(index, 0, { ...moving, assignee: destinationAssignee, done: status === "done", inProgress: status === "in-progress" });
      const updates = ordered.map((task, rank) => db.update(todos).set({
        rank,
        ...(task.ideaId === id ? { done: task.done, inProgress: task.inProgress, ...(input.assignee === undefined ? {} : { assignee: task.assignee }) } : {}),
      }).where(and(eq(todos.team, number), eq(todos.ideaId, task.ideaId))).returning());
      const updated = await db.batch([updates[0]!, ...updates.slice(1)]);
      return response({ tasks: updated.flat() });
    }
    if (input.action === "add-todo") {
      await db.insert(todos).values({ team: number, ideaId: id, assignee, created: new Date().toISOString() }).onConflictDoNothing();
      const [todo] = await db.select().from(todos).where(and(eq(todos.team, number), eq(todos.ideaId, id)));
      return response({ todo });
    }
    const [todo] = await db.update(todos).set(input.action === "set-todo-assignee" ? { assignee } : { done: status === "done", inProgress: status === "in-progress", rank: null }).where(and(eq(todos.team, number), eq(todos.ideaId, id))).returning();
    return todo ? response({ todo }) : response({ error: "Add this idea to the to-do list first." }, 404);
  }
  if (input.action === "reopen") {
    if (!displayName(request)) return response({ error: "Set your display name before reopening a problem." }, 422);
    const db = getDb();
    if (!id || (await findEntry(db, number, id))?.kind !== "problem") {
      return response({ error: "This problem could not be found." }, 404);
    }
    const [entry] = await db.update(contributions).set({ outcomeFor: null, parent: id }).where(and(
      eq(contributions.team, number), eq(contributions.outcomeFor, id), eq(contributions.kind, "resolution")
    )).returning();
    if (!entry) return response({ error: "This problem is already active." }, 409);
    return response({ entry: publicEntry(entry) });
  }
  if (input.action === "edit-problem") {
    const db = getDb();
    const problem = id ? await findEntry(db, number, id) : undefined;
    if (problem?.kind !== "problem") return response({ error: "This problem could not be found." }, 404);
    const field = input.field;
    const value = trim(input.value);
    if ((field !== "title" && field !== "body" && field !== "severity") || !value ||
        (field === "title" && value.length > 120) || (field === "body" && value.length > 3000) ||
        (field === "severity" && !validSeverity(value))) {
      return response({ error: "Enter a valid problem title, description, or severity." }, 400);
    }
    const changes = field === "title" ? { title: value } : field === "body" ? { body: value } : { severity: value as Severity };
    const [saved] = await db.insert(contributions).values({ ...publicEntry(problem), ...changes, team: number })
      .onConflictDoUpdate({ target: contributions.id, setWhere: eq(contributions.team, number), set: changes }).returning();
    return response({ entry: publicEntry(saved, teamSeed(number).find(entry => entry.id === id)?.source) });
  }
  if (!id || !body || body.length > 3000) {
    return response({ error: "Enter text between 1 and 3,000 characters." }, 400);
  }

  const db = getDb();
  const seed = teamSeed(number).find(entry => entry.id === id);
  const current = await findEntry(db, number, id);
  if (!current) return response({ error: "This entry could not be found." }, 404);
  if (current.kind === "comment") {
    const name = displayNameKey(await currentDisplayName(db, number, displayName(request)));
    if (!name || name !== displayNameKey(await currentDisplayName(db, number, current.author))) {
      return response({ error: "You can only edit comments posted under your display name." }, 403);
    }
    if (body !== current.body) {
      await db.update(contributions).set({ body }).where(and(eq(contributions.team, number), eq(contributions.id, id)));
    }
    return response({ entry: { ...publicEntry(current), body } });
  }
  if (!editableKinds.includes(current.kind)) return response({ error: "This entry cannot be edited." }, 400);
  if (!title || title.length > 120) return response({ error: "Enter a title between 1 and 120 characters." }, 400);
  if (input.severity !== undefined && (current.kind !== "problem" || !validSeverity(input.severity))) {
    return response({ error: "Choose High, Medium or Low severity." }, 400);
  }
  const severity = current.kind === "problem" ? (validSeverity(input.severity) ? input.severity : current.severity ?? "medium") : undefined;
  if (current.title === title && current.body === body && (current.kind !== "problem" || severity === (current.severity ?? "medium"))) {
    return response({ entry: publicEntry(current, seed?.source) });
  }
  const entry = { ...publicEntry(current), title, body, ...(severity ? { severity } : {}) };
  await db.insert(contributions).values({ ...entry, team: number }).onConflictDoUpdate({
    target: contributions.id,
    setWhere: eq(contributions.team, number),
    set: { title, body, ...(severity ? { severity } : {}) },
  });
  return response({ entry: publicEntry({ ...current, title, body, ...(severity ? { severity } : {}) }, seed?.source) });
}

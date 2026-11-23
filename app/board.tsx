"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { compareTaskRank, severities, taskStatus, taskStatuses, taskStatusLabels, withoutEntryBranches, type TaskStatus, type Entry, type Kind, type Severity, type TeamInfo, type Todo } from "../lib/board";

import { publishedAt } from "../lib/release";
import { displayNameKey } from "../lib/board-cookies";

const boardSections = {
  inspiration: {
    title: "Idea Lab",
    search: "Find inspiration",
    description: "Share something that inspired you and build on each other’s ideas for the robot, the pit, or the team.",
  },
  problem: {
    title: "Virtual Pit",
    search: "Find a problem or idea",
    description: "Flag problems, troubleshoot them together, and refine solutions as you test.",
  },
  todo: {
    title: "To-do list",
    search: "Find a to-do",
    description: "Assign and check off work queued from the Idea Lab or Virtual Pit.",
  },
  activity: {
    title: "Recent activity",
    search: "Find activity",
    description: "See what teammates have added, discussed, and starred.",
  },
  enhancement: {
    title: "App enhancements",
    search: "Find a request",
    description: "Suggest improvements to FTC Workshop, discuss them, and star the requests you’d use.",
  },
} as const;
const mainSections = ["inspiration", "problem", "todo", "activity"] as const;
const mobileLayout = "(max-width: 740px)";

type Draft = { kind: Kind; parent?: string; context?: string; edit?: Entry; deleting?: boolean; identity?: boolean; starred?: boolean };
type TouchDrag = {
  pointerId: number;
  taskId: string;
  title: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  frame?: number;
};
const labels: Record<Kind, string> = { problem: "problem", inspiration: "inspiration", enhancement: "enhancement request", idea: "idea", comment: "comment", test: "test", vote: "star", resolution: "resolution", completion: "completion" };
const actionTitles: Partial<Record<Kind, string>> = { test: "Log a test run", resolution: "Close problem" };
const actionNotes: Partial<Record<Kind, string>> = { test: "What did you test, and what happened?", resolution: "Resolution description" };
const actionSaves: Partial<Record<Kind, string>> = { test: "Log test", vote: "Add star", resolution: "Mark as solved" };
const untitled = (kind: Kind) => ["comment", "test", "vote", "resolution"].includes(kind);
const update = (list: Entry[], next: Entry[]) => [...new Map([...list, ...next].map(e => [e.id, e])).values()];

const severityLabels: Record<Severity | "resolved", string> = { high: "High", medium: "Medium", low: "Low", resolved: "Resolved" };

const activityVerbs: Partial<Record<Kind, string>> = {
  problem: "posted a problem",
  inspiration: "shared inspiration",
  idea: "added an idea",
  enhancement: "requested an enhancement",
  comment: "commented on",
  vote: "starred",
};

const activityDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/Denver",
});

function ProblemStatus({ status, full = false }: { status: Severity | "resolved"; full?: boolean }) {
  const label = severityLabels[status];
  return <span className={`problem-status status-${status}${full ? " status-full" : ""}`} aria-label={full ? undefined : label} role={full ? undefined : "img"} title={status === "resolved" ? label : label + " severity"}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === "high" ? <path d="M12 3 2.5 20h19L12 3Zm0 6v5m0 3h.01" /> :
        status === "medium" ? <path d="M12 3 21 12 12 21 3 12l9-9Zm0 5v5m0 3h.01" /> :
        status === "low" ? <><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></> :
        <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>}
    </svg>
    {full && label}
  </span>;
}

function ChecklistIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3 6 2 2 3-4m3 3h9M3 11h5v5H3zm8 2.5h9M3 19h5m3 0h9"/>
  </svg>;
}

function CheckIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 6" /></svg>;
}

function EntrySource({ entry }: { entry: Entry }) {
  return <p className="entry-source">Source: {entry.source ?? entry.author}</p>;
}

function EditButton({ entry, disabled, onClick, label }: { entry: Entry; disabled: boolean; onClick: () => void; label?: string }) {
  return <button type="button" className="edit-pencil" aria-label={label ?? (entry.kind === "comment" ? "Edit your comment" : `Edit ${entry.kind}: ${entry.title}`)} title={label ?? (entry.kind === "comment" ? "Edit your comment" : "Edit title and description")} disabled={disabled} onClick={onClick}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/></svg>
  </button>;
}

export default function Board({
  initialEntries, request = fetch, root = "/", assetOrigin = "",
}: { initialEntries: Entry[]; request?: typeof fetch; root?: string; assetOrigin?: string }) {
  const [team, setTeam] = useState<TeamInfo>();
  const [entries, setEntries] = useState(initialEntries);
  const [tab, setTab] = useState<keyof typeof boardSections>("inspiration");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const section = boardSections[tab];
  const [todos, setTodos] = useState<Todo[]>([]);
  const [swimlanes, setSwimlanes] = useState(false);
  const [draggedTask, setDraggedTask] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{ column: string; before?: string }>();
  const touchDrag = useRef<TouchDrag | undefined>(undefined);
  const [dragPreview, setDragPreview] = useState<{ title: string; x: number; y: number }>();
  const [problemEdit, setProblemEdit] = useState<{ id: string; field: "title" | "body" }>();
  const [pendingTodo, setPendingTodo] = useState<string>();
  const [assignment, setAssignment] = useState<Entry>();
  const [assignmentError, setAssignmentError] = useState("");
  const assignmentDialog = useRef<HTMLDialogElement>(null);
  const [jump, setJump] = useState<string>();
  const [selected, setSelected] = useState(initialEntries[0]?.id ?? "");
  const [problemDetailOpen, setProblemDetailOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(initialEntries[1] ? [initialEntries[1].id] : []);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [ownCommentIds, setOwnCommentIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [knownNames, setKnownNames] = useState<string[]>([]);
  const nameQuery = displayNameKey(nameDraft);
  const suggestions = nameQuery ? knownNames.filter(candidate => {
    const key = displayNameKey(candidate);
    return key === nameQuery || (nameQuery.length >= 4 && key.startsWith(nameQuery));
  }).sort((a, b) => Number(displayNameKey(b) === nameQuery) - Number(displayNameKey(a) === nameQuery)).slice(0, 5) : [];
  const exactName = suggestions.some(candidate => displayNameKey(candidate) === nameQuery);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [copying, setCopying] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const boardRevision = useRef(0);
  useEffect(() => {
    let active = true;
    let requestNumber = 0;
    let latestResult = 0;
    async function refresh() {
      const revision = boardRevision.current;
      const number = ++requestNumber;
      try {
        const res = await request("/api/board", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = await res.json() as { entries: Entry[]; displayName: string; ownCommentIds: string[]; knownNames: string[]; todos?: Todo[]; teamInfo?: TeamInfo };
        if (active && revision === boardRevision.current && number > latestResult) { latestResult = number; setTeam(data.teamInfo); setEntries(data.entries); setTodos(data.todos ?? []); setReady(true); setName(data.displayName); setOwnCommentIds(data.ownCommentIds ?? []); setKnownNames(data.knownNames ?? []); setNotice(""); }
      } catch { if (active && revision === boardRevision.current && number > latestResult) { latestResult = number; setReady(false); setNotice("The shared board is unavailable. Reconnecting…"); } }
    }
    void refresh();
    const timer = setInterval(refresh, 12000);
    window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [request]);
  useEffect(() => {
    if (draft && !dialog.current?.open) dialog.current?.showModal();
    else if (!draft && dialog.current?.open) dialog.current.close();
  }, [draft]);
  useEffect(() => {
    if (!jump) return;
    const target = document.getElementById(jump);
    target?.focus({ preventScroll: true });
    if (jump === "board-section-title" && window.matchMedia(mobileLayout).matches) {
      window.scrollTo(0, 0);
    } else {
      target?.scrollIntoView({ block: jump === "back-to-problems" ? "start" : "center" });
    }
    setJump(undefined);
  }, [jump]);

  useEffect(() => {
    if (assignment && !assignmentDialog.current?.open) assignmentDialog.current?.showModal();
    else if (!assignment && assignmentDialog.current?.open) assignmentDialog.current.close();
  }, [assignment]);

  useEffect(() => {
    if (team) document.title = "FTC Workshop | " + team.name;
  }, [team]);

  useEffect(() => () => {
    if (touchDrag.current?.frame !== undefined) cancelAnimationFrame(touchDrag.current.frame);
  }, []);

  function openAssignment(idea: Entry) {
    setAssignmentError("");
    setAssignment(idea);
  }

  function navigate(next: keyof typeof boardSections, fromMenu = false) {
    setTab(next);
    setSearch("");
    setMenuOpen(false);
    setProblemDetailOpen(false);
    setProblemEdit(undefined);
    if (fromMenu) setJump("board-section-title");
  }

  function openProblem(id: string) {
    setSelected(id);
    setProblemDetailOpen(true);
  }

  function open(next: Draft) { setError(""); setNameDraft(""); setDraft(next); }
  function edit(entry: Entry) { open({ kind: entry.kind, edit: entry }); }
  async function useName(author: string, confirmExisting: boolean) {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const res = await request("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-display-name", author, confirmExisting }) });
      if (!res.ok) throw new Error(res.status < 500 ? (await res.json() as { error: string }).error : "Could not set your name. Please try again.");
      const data = await res.json() as { displayName: string; ownCommentIds: string[] };
      boardRevision.current++;
      setName(data.displayName);
      setOwnCommentIds(data.ownCommentIds);
      if (draft?.identity) setDraft(undefined);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not set your name. Please try again."); }
    finally { setSaving(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const data = new FormData(event.currentTarget);
    const author = String(data.get("author") ?? "").trim();
    if (draft.identity) { await useName(author, false); return; }
    await saveContribution(draft, { title: data.get("title"), body: data.get("body"), severity: data.get("severity") ?? undefined }, author);
  }

  async function saveContribution(next: Draft, fields: { title?: FormDataEntryValue | null; body?: FormDataEntryValue | null; severity?: FormDataEntryValue } = {}, author = "") {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const res = await request("/api/board", {
        method: next.edit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next.edit ? { ...fields, id: next.edit.id } : { ...fields, kind: next.kind, parent: next.parent, author, starred: next.starred }),
      });
      if (res.status === 422) setName("");
      if (!res.ok) throw new Error(res.status < 500 ? (await res.json() as { error: string }).error : "Could not save. Please try again.");
      const { entry } = await res.json() as { entry: Entry };
      boardRevision.current++;
      setEntries(e => update(e, [entry]));
      if (next.edit) {
        if (entry.kind !== "comment") setSearch("");
        if (entry.kind === "problem") setSelected(entry.id);
        setDraft(undefined);
        return;
      }
      setName(entry.author);
      setKnownNames(names => names.some(candidate => displayNameKey(candidate) === displayNameKey(entry.author)) ? names : [...names, entry.author]);
      if (entry.kind === "comment") setOwnCommentIds(ids => [...ids, entry.id]);
      if (entry.kind === "problem") {
        navigate("problem");
        openProblem(entry.id);
        if (window.matchMedia(mobileLayout).matches) setJump("back-to-problems");
      }
      if (entry.kind === "inspiration" || entry.kind === "enhancement") { setTab(entry.kind); setSearch(""); }
      if (entry.kind === "idea") setExpanded(ids => [...ids, entry.id]);
      setDraft(undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save. Please try again.";
      if (draft) setError(message); else setNotice(message);
    }
    finally { setSaving(false); }
  }
  async function deleteEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft?.edit || saving || confirmation !== "delete") return;
    const { id, kind } = draft.edit;
    setSaving(true);
    setError("");
    try {
      const res = await request("/api/board", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-entry", id, confirmation }),
      });
      if (!res.ok) throw new Error(res.status < 500 ? (await res.json() as { error: string }).error : "Could not delete the entry.");
      boardRevision.current++;
      setEntries(items => withoutEntryBranches(items, [id]));
      setDraft(undefined);
      setNotice(`Deleted ${labels[kind]}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the entry.");
    } finally {
      setSaving(false);
    }
  }

  async function copyInvite() {
    setCopying(true);
    try {
      const invite = request("/api/board?share=invite", { cache: "no-store" }).then(async res => {
        if (!res.ok) throw new Error("Invite unavailable.");
        return (await res.json() as { url: string }).url;
      });
      if (typeof ClipboardItem === "function" && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": invite.then(url => new Blob([url], { type: "text/plain" })),
        })]);
      } else {
        await navigator.clipboard.writeText(await invite);
      }
      setNotice("Team invite link copied.");
    } catch {
      setNotice("Couldn’t copy the invite link. Try again.");
    } finally {
      setCopying(false);
    }
  }

  async function download() {
    try {
      const response = await request("/api/board", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const { version, team, teamInfo, entries, todos = [] } = await response.json() as { version: number; team: string; teamInfo?: TeamInfo; entries: Entry[]; todos?: Todo[] };
      const blob = new Blob([JSON.stringify({ version, team, teamInfo, entries, todos }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `ftc-${team}-board.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setNotice("Couldn't download the shared board. Please try again."); }
  }

  async function saveTodo(id: string, change: { action: "add-todo" | "set-todo-assignee"; assignee: string | null } | { action: "set-todo-status"; status: TaskStatus } | { action: "move-todo"; status: TaskStatus; before?: string; assignee?: string | null }) {
    if (pendingTodo) return;
    setPendingTodo(id);
    setNotice("");
    try {
      const response = await request("/api/board", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...change }),
      });
      if (!response.ok) throw new Error(response.status < 500 ? (await response.json() as { error: string }).error : "Could not save the to-do.");
      const result = await response.json() as { todo: Todo } | { tasks: Todo[] };
      boardRevision.current++;
      setTodos(items => [...new Map([...items, ...("tasks" in result ? result.tasks : [result.todo])].map(item => [item.ideaId, item])).values()]);
      if (change.action === "add-todo") setAssignment(undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the to-do.";
      if (change.action === "add-todo") setAssignmentError(message);
      else setNotice(message);
    } finally { setPendingTodo(undefined); }
  }

  const problems = entries.filter(e => e.kind === "problem");
  const ideas = entries.filter(e => e.kind === "idea");
  const inspirations = entries.filter(e => e.kind === "inspiration");
  const childrenOf = (id: string) => ideas.filter(e => e.parent === id);
  const matches = (e: Entry) => (e.title + " " + e.body).toLowerCase().includes(search.trim().toLowerCase());
  const enhancementRequests = entries.filter(e => e.kind === "enhancement" && matches(e));
  const visible = (e: Entry) => matches(e) || childrenOf(e.id).some(matches);
  const resolutions = new Map(entries.filter(e => e.kind === "resolution" && e.active).map(e => [e.parent, e]));
  const shown = problems.filter(visible).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  const activeProblems = shown.filter(p => !resolutions.has(p.id)).sort((a, b) => severities.indexOf(a.severity ?? "medium") - severities.indexOf(b.severity ?? "medium"));
  const solvedProblems = shown.filter(p => resolutions.has(p.id));
  const current = shown.find(p => p.id === selected) ?? activeProblems[0] ?? solvedProblems[0];
  const showProblemDetail = tab === "problem" && problemDetailOpen && current?.id === selected;
  const todoByIdea = new Map(todos.map(todo => [todo.ideaId, todo]));
  const lookup = new Map(entries.map(entry => [entry.id, entry]));
  const todoRows = todos.flatMap(todo => {
    const idea = lookup.get(todo.ideaId);
    const parent = idea?.parent ? lookup.get(idea.parent) : undefined;
    return idea && parent && (idea.kind === "idea") && (matches(idea) || matches(parent)) ? [{ todo, idea, parent }] : [];
  });

  const lanes = swimlanes ? [...new Set([...knownNames, ...todos.map(todo => todo.assignee || ""), ""])]
    .sort((a, b) => a ? b ? a.localeCompare(b) : -1 : 1) : [""];
  if (!lanes.length) lanes.push("");

  async function saveProblemField(problem: Entry, field: "title" | "body" | "severity", value: string) {
    if (saving) return;
    setSelected(problem.id);
    setSaving(true);
    setNotice("");
    try {
      const res = await request("/api/board", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit-problem", id: problem.id, field, value }),
      });
      if (!res.ok) throw new Error(res.status < 500 ? (await res.json() as { error: string }).error : "Could not save the problem.");
      const { entry } = await res.json() as { entry: Entry };
      boardRevision.current++;
      setEntries(items => update(items, [entry]));
      setProblemEdit(undefined);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save the problem.");
    } finally { setSaving(false); }
  }

  function problemField(problem: Entry, field: "title" | "body") {
    const editing = problemEdit?.id === problem.id && problemEdit.field === field;
    const label = field === "title" ? "title" : "description";
    if (editing) return <form className="inline-problem-form" onSubmit={event => {
      event.preventDefault();
      void saveProblemField(problem, field, String(new FormData(event.currentTarget).get("value") ?? ""));
    }}>
      {field === "title" ? <input className="inline-title-input" aria-label="Problem title" name="value" defaultValue={problem.title} maxLength={120} required autoFocus /> :
        <textarea aria-label="Problem description" name="value" defaultValue={problem.body} rows={2} maxLength={3000} required autoFocus />}
      <div className="inline-actions">
        {field === "title" && <button type="button" className="quiet small danger" disabled={saving} onClick={() => {
          setConfirmation("");
          setProblemEdit(undefined);
          open({ kind: "problem", edit: problem, deleting: true });
        }}>Delete problem</button>}
        <button type="button" className="quiet small" disabled={saving} onClick={() => setProblemEdit(undefined)}>Cancel</button>
        <button className="primary small" disabled={saving}>Save {label}</button>
      </div>
    </form>;
    const editControl = <EditButton entry={problem} label={`Edit problem ${label}`} disabled={!ready || saving}
      onClick={() => {
        setSelected(problem.id);
        setProblemEdit({ id: problem.id, field });
      }} />;
    return field === "title"
      ? <h3 className="inline-problem-field inline-problem-title">{problem.title}{editControl}</h3>
      : <p className="body inline-problem-field">{problem.body}{editControl}</p>;
  }

  function clearTaskDrag() {
    if (touchDrag.current?.frame !== undefined) cancelAnimationFrame(touchDrag.current.frame);
    touchDrag.current = undefined;
    setDraggedTask(undefined);
    setDropTarget(undefined);
    setDragPreview(undefined);
  }

  function dropTask(taskId: string, status: TaskStatus, lane: string, before?: string) {
    const task = todoByIdea.get(taskId);
    clearTaskDrag();
    if (!task || task.ideaId === before) return;
    void saveTodo(task.ideaId, { action: "move-todo", status, before, ...(swimlanes ? { assignee: lane || null } : {}) });
  }

  function insertionPoint(column: HTMLElement, y: number, taskId: string) {
    const cards = Array.from(column.querySelectorAll<HTMLElement>("[data-task-id]"));
    return cards.find(card => {
      if (card.dataset.taskId === taskId) return false;
      const bounds = card.getBoundingClientRect();
      return y < bounds.top + bounds.height / 2;
    })?.dataset.taskId;
  }

  function highlightDrop(column: string, before?: string) {
    setDropTarget(target => target?.column === column && target.before === before ? target : { column, before });
  }

  function touchDropColumn(x: number, y: number) {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-kanban-column]");
  }

  function updateTouchTarget(drag: TouchDrag) {
    const column = touchDropColumn(drag.x, drag.y);
    if (column?.dataset.kanbanColumn) {
      highlightDrop(column.dataset.kanbanColumn, insertionPoint(column, drag.y, drag.taskId));
    } else {
      setDropTarget(undefined);
    }
  }

  function scrollDuringDrag(drag: TouchDrag) {
    if (touchDrag.current !== drag) return;
    const edge = 64;
    const top = Math.max(0, edge - drag.y);
    const bottom = Math.max(0, drag.y - (window.innerHeight - edge));
    if (top || bottom) {
      const previous = window.scrollY;
      window.scrollBy({ top: (bottom - top) / 3, behavior: "instant" });
      if (window.scrollY !== previous) updateTouchTarget(drag);
    }
    drag.frame = requestAnimationFrame(() => scrollDuringDrag(drag));
  }

  function startTouchDrag(event: PointerEvent<HTMLDivElement>, idea: Entry) {
    if (event.pointerType === "mouse" || !event.isPrimary || !ready || pendingTodo || touchDrag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    touchDrag.current = {
      pointerId: event.pointerId, taskId: idea.id, title: idea.title,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false,
    };
  }

  function moveTouchDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = touchDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 8) return;
      drag.active = true;
      setDraggedTask(drag.taskId);
      drag.frame = requestAnimationFrame(() => scrollDuringDrag(drag));
    }
    setDragPreview({ title: drag.title, x: drag.x, y: drag.y });
    updateTouchTarget(drag);
  }

  function finishTouchDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = touchDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const column = drag.active ? touchDropColumn(event.clientX, event.clientY) : undefined;
    const status = taskStatuses.find(value => value === column?.dataset.kanbanStatus);
    if (column && status) {
      dropTask(drag.taskId, status, column.dataset.kanbanLane ?? "", insertionPoint(column, event.clientY, drag.taskId));
    } else {
      clearTaskDrag();
    }
  }

  function cancelTouchDrag(event: PointerEvent<HTMLDivElement>) {
    if (touchDrag.current?.pointerId === event.pointerId) clearTaskDrag();
  }

  const recentActivity = tab === "activity" ? entries.flatMap(entry => {
    if (entry.source || !activityVerbs[entry.kind]) return [];
    const target = entry.kind === "comment" || entry.kind === "vote"
      ? lookup.get(entry.parent ?? "") : entry;
    if (!target) return [];
    const action = entry.starred && entry.kind === "comment" ? "starred and commented on" : activityVerbs[entry.kind];
    const query = search.trim().toLowerCase();
    if (!`${entry.author} ${action} ${target.title} ${entry.body}`.toLowerCase().includes(query)) return [];
    return [{ entry, target, action }];
  }).sort((a, b) => b.entry.created.localeCompare(a.entry.created)).slice(0, 50) : [];

  function showIdea(idea: Entry, parent: Entry, focusId = "idea-toggle-" + idea.id) {
    setSearch("");
    setTab(parent.kind === "problem" ? "problem" : "inspiration");
    if (parent.kind === "problem") openProblem(parent.id);
    expand(idea.id);
    setJump(focusId);
  }

  function showActivity(entry: Entry, target: Entry) {
    const focusId = entry.kind === "comment" ? "comment-" + entry.id : undefined;
    if (target.kind === "idea") {
      const parent = lookup.get(target.parent ?? "");
      if (parent) showIdea(target, parent, focusId);
      return;
    }
    if (target.kind === "problem") openProblem(target.id);
    if (target.kind === "problem" || target.kind === "inspiration" || target.kind === "enhancement") {
      setSearch("");
      setTab(target.kind);
      setJump(focusId ?? "entry-" + target.id);
    }
  }

  const resolution = current ? resolutions.get(current.id) : undefined;

  function expand(id: string) {
    setExpanded(ids => ids.includes(id) ? ids : [...ids, id]);
  }

  async function reopen(problem: Entry) {
    if (saving) return;
    setSelected(problem.id);
    setSaving(true);
    try {
      const res = await request("/api/board", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reopen", id: problem.id }) });
      if (!res.ok) throw new Error(res.status < 500 ? (await res.json() as { error: string }).error : "Could not reopen the problem.");
      const { entry } = await res.json() as { entry: Entry };
      boardRevision.current++;
      setEntries(e => update(e, [entry]));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not reopen the problem.");
    } finally { setSaving(false); }
  }

  function logEntry(e: Entry) {
    const mine = ownCommentIds.includes(e.id);
    const historyLabel = e.kind === "completion" ? "Completion note" : undefined;
    return <div className="comment" key={e.id} id={`comment-${e.id}`} tabIndex={-1}>
      <div className={mine ? "editable-entry" : undefined}>
        {e.starred && <span className="comment-star" role="img" aria-label="Starred this idea" title="Starred this idea">★</span>}
        {historyLabel && <span className="history-label">{historyLabel}</span>}
        <strong>{e.author}</strong>{" "}<time dateTime={e.created}>{new Date(e.created).toLocaleDateString(undefined, {month:"short",day:"numeric"})}</time>
        <p className="body">{e.body}</p>
        {mine && <EditButton entry={e} disabled={!ready} onClick={() => edit(e)} />}
      </div>
    </div>;
  }

  function discussion(target: Entry, comments: Entry[]) {
    return <section className="discussion">
      <div className="discussion-head"><h4>Discussion</h4><button className="quiet small" disabled={!ready} onClick={() => open({kind: "comment", parent: target.id, context: target.title})}>＋ Add comment</button></div>
      {!comments.length && <p className="meta">No comments yet.</p>}
      {comments.map(logEntry)}
    </section>;
  }

  function starButton(entry: Entry, votes: Entry[], withComment = false) {
    const hasVoted = Boolean(name) && votes.some(vote => displayNameKey(vote.author) === displayNameKey(name));
    const subject = entry.kind === "enhancement" ? "request" : "idea";
    return <button type="button" className="star-button"
      aria-label={`${hasVoted ? "You starred" : "Star"} ${entry.title}. ${votes.length} ${votes.length === 1 ? "star" : "stars"}`}
      aria-pressed={hasVoted}
      title={hasVoted ? `You already starred this ${subject}` : `Star this ${subject}${withComment ? " and explain why" : ""}`}
      disabled={!ready || hasVoted || saving}
      onClick={() => {
        const vote: Draft = { kind: withComment ? "comment" : "vote", parent: entry.id, context: entry.title, starred: withComment };
        if (withComment) expand(entry.id);
        if (withComment || !name) open(vote);
        else void saveContribution(vote);
      }}><span aria-hidden="true">{hasVoted ? "★" : "☆"}</span>{votes.length}</button>;
  }

  function ideaCards(parent: Entry) {
    const isProblem = parent.kind === "problem";
    const childIdeas = childrenOf(parent.id);
    const shownIdeas = !search || matches(parent) ? childIdeas : childIdeas.filter(matches);
    return <>
      <div className="detail-head"><h4>{isProblem ? "Ideas to test" : "Ideas"}</h4><button className="quiet" disabled={!ready} onClick={() => open({ kind: "idea", parent: parent.id, context: parent.title })}>＋ Add idea</button></div>
      {shownIdeas.map(i => {
        const items = entries.filter(e => e.parent === i.id);
        const comments = items.filter(e => ["comment", "completion"].includes(e.kind));
        const tests = items.filter(e => e.kind === "test");
        const votes = items.filter(e => e.starred);
        const isOpen = expanded.includes(i.id);
        const todo = todoByIdea.get(i.id);
        const logTest = () => {
          expand(i.id);
          open({kind: "test", parent: i.id, context: i.title});
        };
        return <article className="idea" key={i.id}>
          <div className="idea-header">
            <button id={"idea-toggle-" + i.id} className="idea-title" aria-expanded={isOpen} aria-controls={"idea-" + i.id} onClick={() => setExpanded(ids => isOpen ? ids.filter(id => id !== i.id) : [...ids, i.id])}>
              <span className="chevron" aria-hidden="true">{isOpen ? "−" : "+"}</span><strong>{i.title}</strong><small>{comments.length} {comments.length === 1 ? "comment" : "comments"}</small>
            </button>
            <div className="idea-tools">
            {isProblem && (isOpen || tests.length > 0) && <button type="button" className="test-count" aria-label={`Log a test for ${i.title}. ${tests.length} ${tests.length === 1 ? "test run" : "test runs"}`} title="Log a test" disabled={!ready} onClick={logTest}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v7L4.5 19a1 1 0 0 0 1 2h13a1 1 0 0 0 1-2L14 10V3M8 15h8"/></svg>{tests.length > 0 && tests.length}
            </button>}
            {todo?.done ? <span className="task-complete task-icon" role="img" aria-label={`Task complete: ${i.title}`} title="Task complete"><CheckIcon /></span> :
              <button type="button" className="quiet task-icon" title={todo ? "Complete task" : "Add task"}
                aria-label={`${todo ? "Complete task" : "Add task"}: ${i.title}`} disabled={!ready || Boolean(pendingTodo)}
                onClick={() => {
                  if (todo) void saveTodo(i.id, { action: "set-todo-status", status: "done" });
                  else openAssignment(i);
                }}>{todo ? <CheckIcon /> : <ChecklistIcon />}</button>}
            {starButton(i, votes, isProblem)}
            </div>
          </div>
          <div id={"idea-" + i.id} hidden={!isOpen} className="idea-body">
            <div className="editable-entry idea-description"><p className="body">{i.body}</p><EntrySource entry={i} /><EditButton entry={i} disabled={!ready} onClick={() => edit(i)} /></div>
            {discussion(i, comments)}
            {isProblem && <section className="discussion">
              <div className="discussion-head"><h4>Tests</h4><button className="quiet small" disabled={!ready} onClick={logTest}>＋ Log test</button></div>
              {!tests.length && <p className="meta">No test runs logged yet.</p>}
              {tests.map(logEntry)}
            </section>}

          </div>
        </article>;
      })}
      {!childIdeas.length && <p className="empty">No ideas yet. Add something the team could try.</p>}
    </>;
  }

  function problemLinks(items: Entry[], solved: boolean) {
    return items.map(p => <button key={p.id} id={`problem-row-${p.id}`} className={current?.id === p.id ? "selected" : ""} onClick={() => {
      openProblem(p.id);
      if (window.matchMedia(mobileLayout).matches) setJump("back-to-problems");
    }}>
      <span className="problem-link-label"><ProblemStatus status={solved ? "resolved" : p.severity ?? "medium"} /><span>{p.title}</span></span><small>{childrenOf(p.id).length}</small>
      <span className="problem-row-chevron" aria-hidden="true">›</span>
    </button>);
  }
  function navigationButtons(fromMenu = false) {
    return mainSections.map(key => <button type="button" key={key}
      className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined}
      onClick={() => navigate(key, fromMenu)}>{boardSections[key].title}</button>);
  }

  return <>
    <header className="top" onKeyDown={event => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    }}><div className="wrap bar" data-menu-open={menuOpen}>
      <a href={root} className="brand">{team?.logo && <img src={assetOrigin + team.logo} width="48" height="48" alt="" />}<span>{team?.name ?? "Protostars"}{team && <small>FIRST TECH CHALLENGE · TEAM {team.number}</small>}</span></a>
      <button type="button" ref={menuButton} className="quiet mobile-menu-toggle" aria-label="Workshop menu" aria-expanded={menuOpen} aria-controls="workshop-menu" onClick={() => setMenuOpen(open => !open)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d={menuOpen ? "m6 6 12 12M18 6 6 18" : "M4 6h16M4 12h16M4 18h16"} />
        </svg>
      </button>
      <div className="workshop-menu" id="workshop-menu">
      <nav className="tabs mobile-nav" aria-label="Workshop sections">{navigationButtons(true)}</nav>
      <div className="tools header-tools">{!name && <button className="quiet" disabled={!ready} onClick={() => { setMenuOpen(false); open({kind: "comment", identity: true}); }}>Set display name</button>}
      <button className="quiet header-share" aria-label="Copy team invite link" title="Copy team invite link" onClick={() => { setMenuOpen(false); void copyInvite(); }} disabled={!ready || copying}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="m8.7 10.5 6.6-4m-6.6 7 6.6 4"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/>
        </svg>
      </button>
      <button className="quiet" onClick={() => { setMenuOpen(false); void download(); }} disabled={!ready}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/></svg> Download JSON</button></div>
      </div>
    </div></header>
    <main className={`wrap${showProblemDetail ? " mobile-problem-open" : ""}`}>
      <section className="hero">
        <div><h1>FTC Workshop</h1><p className="workshop-credit">by Team 17097 Protostars</p></div>
        <div className="stats" aria-label="Board shortcuts">
          {([
            { tab: "problem", label: "Problems", count: problems.length },
            { tab: "inspiration", label: "Inspirations", count: inspirations.length },
            { tab: "todo", label: "Tasks", count: todos.filter(todo => lookup.has(todo.ideaId)).length },
          ] as const).map(stat => <button type="button" key={stat.tab} onClick={() => navigate(stat.tab)}><strong>{stat.count}</strong><span>{stat.label}</span></button>)}
        </div>
      </section>
      {notice && <p className="notice" role="status">{notice}</p>}
      <section className="toolbar" aria-label="Workshop controls">
        <nav className="tabs desktop-nav" aria-label="Workshop sections">{navigationButtons()}</nav>

        <div className="tools">
          <input type="search" placeholder={section.search} aria-label="Search current section" value={search} onChange={e => setSearch(e.target.value)} />
          {tab === "todo" && <button className="quiet assignee-toggle" aria-pressed={swimlanes} onClick={() => setSwimlanes(active => !active)}>By assignee</button>}
          {tab !== "todo" && tab !== "activity" && <button className="primary" disabled={!ready} onClick={() => open({ kind: tab })}>＋ Add {tab === "enhancement" ? "request" : labels[tab]}</button>}
        </div>
      </section>
      <section aria-labelledby="board-section-title">
        <header className="section-intro">
          <h2 id="board-section-title" tabIndex={-1}>{section.title}</h2>
          <p>{section.description}</p>
        </header>

        {tab === "problem" ? <div className="board">
          <aside className="problem-list" aria-label="Problems">
            <div className="eyebrow">ACTIVE PROBLEMS <span>{activeProblems.length}</span></div>
            {problemLinks(activeProblems, false)}
            {!activeProblems.length && <p className="empty">No active problems{search ? " match" : ""}.</p>}
            <hr className="problem-divider" />
            <div className="eyebrow">SOLVED PROBLEMS <span>{solvedProblems.length}</span></div>
            {problemLinks(solvedProblems, true)}
            {!solvedProblems.length && <p className="empty">No solved problems{search ? " match" : " yet"}.</p>}
          </aside>
          {current && <div className="problem-detail">
          <button type="button" className="quiet back-to-problems" id="back-to-problems" onClick={() => {
            setProblemDetailOpen(false);
            setProblemEdit(undefined);
            setJump(`problem-row-${current.id}`);
          }}><span aria-hidden="true">←</span> Back to problems</button>
          <section className="detail" aria-label="Selected problem" id={`entry-${current.id}`} tabIndex={-1}>
            <div className="problem-card-toolbar">
              <span className="eyebrow">PROBLEM</span>
              <label className="severity-control">
                <ProblemStatus status={resolution ? "resolved" : current.severity ?? "medium"} full />
                <span aria-hidden="true" className="severity-caret">⌄</span>
                <select aria-label="Problem severity or status" disabled={!ready || saving}
                  value={resolution ? "resolved" : current.severity ?? "medium"} onChange={event => {
                    const value = event.currentTarget.value;
                    if (value === "close") {
                      setSelected(current.id);
                      open({ kind: "resolution", parent: current.id, context: current.title });
                    }
                    else if (value === "reopen") void reopen(current);
                    else void saveProblemField(current, "severity", value);
                  }}>
                  {resolution && <option value="resolved" disabled>Solved</option>}
                  {severities.map(severity => <option key={severity} value={severity} disabled={Boolean(resolution)}>{severityLabels[severity]}</option>)}
                  {resolution ? <option value="reopen" disabled={!name}>Reopen problem</option> : <option value="close">Close problem…</option>}
                </select>
              </label>
            </div>
            {problemField(current, "title")}
            {problemField(current, "body")}
            <EntrySource entry={current} />
            {resolution && <section className="resolution-panel" aria-label="Resolution">
              <div className="discussion-head"><h4>Resolution</h4></div>
              <p className="body">{resolution.body}</p><p className="meta">Resolved by {resolution.author}</p>
            </section>}
            {ideaCards(current)}
          </section></div>}
        </div> : tab === "inspiration" ? <div className="inspiration">
          <div className="inspiration-grid">{inspirations.filter(visible).map(i => <article className="inspiration-card" key={i.id} id={`entry-${i.id}`} tabIndex={-1}>
            <div className="editable-entry"><div className="eyebrow">INSPIRATION</div><h3>{i.title}</h3><p className="body">{i.body}</p><EntrySource entry={i} /><EditButton entry={i} disabled={!ready} onClick={() => edit(i)} /></div>
            {discussion(i, entries.filter(e => e.kind === "comment" && e.parent === i.id))}
            {ideaCards(i)}
          </article>)}</div>
          {!inspirations.some(visible) && <p className="empty">No matching inspiration.</p>}
        </div> : tab === "enhancement" ? <div className="enhancements">
          {enhancementRequests.map(entry => {
            const activity = entries.filter(item => item.parent === entry.id);
            return <article className="detail enhancement-card" key={entry.id} id={`entry-${entry.id}`} tabIndex={-1} aria-labelledby={`request-${entry.id}`}>
              <div className="enhancement-heading">
                <div className="editable-entry">
                  <h3 id={`request-${entry.id}`}>{entry.title}</h3>
                  <p className="body">{entry.body}</p>
                  <EntrySource entry={entry} />
                  <EditButton entry={entry} disabled={!ready} onClick={() => edit(entry)} />
                </div>
                {starButton(entry, activity.filter(item => item.starred))}
              </div>
              {discussion(entry, activity.filter(item => item.kind === "comment"))}
            </article>;
          })}
          {!enhancementRequests.length && <p className="empty">{search.trim() ? "No matching requests." : "No enhancement requests yet."}</p>}
        </div> : tab === "activity" ? (
          recentActivity.length ? <ol className="activity-feed">
            {recentActivity.map(({ entry, target, action }) => <li className="detail activity-item" key={entry.id}>
              <div className="activity-meta">
                <span><strong>{entry.author}</strong> {action}</span>
                <time dateTime={entry.created} title="Mountain time">{activityDate.format(new Date(entry.created))} MT</time>
              </div>
              <button type="button" className="todo-link" onClick={() => showActivity(entry, target)}>{target.title}</button>
              {entry.body && <p className="body activity-preview">{entry.body}</p>}
            </li>)}
          </ol> : <p className="empty">{search.trim() ? "No matching activity." : ready ? "No recent activity yet." : "Loading recent activity…"}</p>
        ) : <div className="kanban-lanes">{lanes.map((lane, laneIndex) => <div className="kanban-lane" key={lane}>
          {swimlanes && <h3>{lane || "Unassigned"}</h3>}
          <div className="kanban">
          {taskStatuses.map(status => {
            const items = todoRows.filter(row => taskStatus(row.todo) === status && (!swimlanes || (row.todo.assignee || "") === lane)).sort((a, b) => compareTaskRank(a.todo, b.todo));
            const columnId = `tasks-${laneIndex}-${status}`;
            const activeDrop = draggedTask && dropTarget?.column === columnId ? dropTarget : undefined;
            return <section className={`kanban-column${activeDrop ? " drop-target" : ""}${activeDrop && !activeDrop.before ? " insert-at-end" : ""}`}
              key={status} aria-labelledby={columnId} data-kanban-column={columnId} data-kanban-status={status} data-kanban-lane={lane}
              onDragOver={event => {
                if (!draggedTask) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                highlightDrop(columnId, insertionPoint(event.currentTarget, event.clientY, draggedTask));
              }}
              onDragLeave={event => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                setDropTarget(target => target?.column === columnId ? undefined : target);
              }}
              onDrop={event => {
                if (!draggedTask) return;
                event.preventDefault();
                dropTask(draggedTask, status, lane, insertionPoint(event.currentTarget, event.clientY, draggedTask));
              }}>
              <h3 id={columnId}>{taskStatusLabels[status]} <small className="meta">{items.length}</small></h3>
              {!items.length && <p className="meta">{search.trim() ? "No matching tasks." : "No tasks here yet."}</p>}
              {items.map(({ idea, parent, todo }, index) => <article className={`kanban-card${draggedTask === idea.id ? " is-dragging" : ""}${activeDrop?.before === idea.id ? " insert-before" : ""}`}
                data-task-id={idea.id} key={idea.id}
                draggable={ready && !pendingTodo}
                onDragStart={event => {
                  if (touchDrag.current) { event.preventDefault(); return; }
                  event.dataTransfer.setData("text/plain", idea.title);
                  event.dataTransfer.effectAllowed = "move";
                  setDraggedTask(idea.id);
                }}
                onDragEnd={clearTaskDrag}>
                <div className="task-rank">
                    <button type="button" className="quiet small" aria-label={`Move ${idea.title} up`}
                      disabled={!ready || Boolean(pendingTodo) || index === 0}
                      onClick={() => void saveTodo(idea.id, { action: "move-todo", status, before: items[index - 1]?.idea.id })}>↑</button>
                    <button type="button" className="quiet small" aria-label={`Move ${idea.title} down`}
                      disabled={!ready || Boolean(pendingTodo) || index === items.length - 1}
                      onClick={() => void saveTodo(idea.id, { action: "move-todo", status, before: items[index + 2]?.idea.id })}>↓</button>
                  </div>
                <div className="task-drag-handle" aria-hidden="true" data-enabled={ready && !pendingTodo}
                  onPointerDown={event => startTouchDrag(event, idea)}
                  onPointerMove={moveTouchDrag} onPointerUp={finishTouchDrag}
                  onPointerCancel={cancelTouchDrag} onLostPointerCapture={cancelTouchDrag}
                  onContextMenu={event => event.preventDefault()}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    {[6, 12, 18].flatMap(cy => [9, 15].map(cx => <circle key={cx + "," + cy} cx={cx} cy={cy} r="1.5" />))}
                  </svg>
                </div>
                <div className="kanban-card-content">
                <button type="button" className="todo-link" onClick={() => showIdea(idea, parent)}>{idea.title}</button>
                <p className="meta">{parent.title}</p>
                <div className="kanban-actions">
                  <select aria-label={`Assignee for ${idea.title}`} value={todo.assignee ?? ""} disabled={!ready || Boolean(pendingTodo)}
                    onChange={event => void saveTodo(idea.id, { action: "set-todo-assignee", assignee: event.currentTarget.value || null })}>
                    <option value="">Unassigned</option>
                    {[...new Set([...knownNames, ...(todo.assignee ? [todo.assignee] : [])])].sort((a, b) => a.localeCompare(b))
                      .map(person => <option key={person} value={person}>{person}</option>)}
                  </select>
                  <select aria-label={`Status for ${idea.title}`} value={status} disabled={!ready || Boolean(pendingTodo)}
                    onChange={event => void saveTodo(idea.id, { action: "set-todo-status", status: event.currentTarget.value as TaskStatus })}>
                    {taskStatuses.map(option => <option key={option} value={option}>{taskStatusLabels[option]}</option>)}
                  </select>
                </div>
                </div>
              </article>)}
            </section>;
          })}
          </div>
        </div>)}</div>}
        {dragPreview && <div aria-hidden="true" className="task-drag-preview" style={{
          left: Math.max(10, Math.min(dragPreview.x - 24, window.innerWidth - 230)),
          top: Math.max(8, dragPreview.y - 58),
        }}>{dragPreview.title}</div>}
      </section>
      <footer className="workshop-footer">
        <div>
          <div>{team ? `Team ${team.number} ${team.name}` : "Team 17097 Protostars"}</div>
          <div>Last updated <time dateTime={publishedAt}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Denver" }).format(new Date(publishedAt))}</time></div>
        </div>
        <button type="button" className="quiet small" aria-pressed={tab === "enhancement"} onClick={() => {
          navigate("enhancement", true);
        }}>App enhancements</button>
      </footer>
    </main>
    <dialog ref={assignmentDialog} aria-labelledby="assignment-title" onCancel={e => {e.preventDefault(); if (!pendingTodo) setAssignment(undefined);}}>
      {assignment && <form onSubmit={event => {
        event.preventDefault();
        const assignee = String(new FormData(event.currentTarget).get("assignee") ?? "") || null;
        void saveTodo(assignment.id, { action: "add-todo", assignee });
      }}>
        <div className="dialog-head"><h2 id="assignment-title">Add task</h2></div>
        <p className="meta">{assignment.title}</p>
        <label>Who should do this?<select name="assignee">
          <option value="">Unassigned</option>
          {knownNames.map(person => <option key={person} value={person}>{person}</option>)}
        </select></label>
        {assignmentError && <p className="notice" role="alert">{assignmentError}</p>}
        <div className="dialog-actions"><button type="button" className="quiet" disabled={Boolean(pendingTodo)} onClick={() => setAssignment(undefined)}>Cancel</button><button className="primary" disabled={Boolean(pendingTodo)}>Add task</button></div>
      </form>}
    </dialog>
    <dialog ref={dialog} aria-labelledby="entry-dialog-title" onCancel={e => {e.preventDefault(); if (!saving) setDraft(undefined);}}>
      {draft?.deleting && draft.edit ? <form onSubmit={deleteEntry}>
        <h2 id="entry-dialog-title">Delete {labels[draft.kind]}?</h2>
        {draft.edit.title && <p className="body">{draft.edit.title}</p>}
        <p className="body">{draft.kind === "comment" ? "This removes the comment from the shared board." : "This removes the entry and its attached discussion, tests, and to-dos from the shared board."}</p>
        <label><span>Type <code>delete</code> to confirm</span><input autoFocus value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} /></label>
        {error && <p className="notice" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="quiet" disabled={saving} onClick={() => setDraft(undefined)}>Cancel</button>
          <button className="quiet danger" disabled={saving || confirmation !== "delete"}>{saving ? "Deleting…" : "Delete " + labels[draft.kind]}</button>
        </div>
      </form> : draft && <form key={draft.edit?.id ?? draft.kind + (draft.parent ?? "")} onSubmit={submit}>
        <div className="dialog-head"><h2 id="entry-dialog-title">{draft.identity ? "Set display name" : draft.starred ? "Star this idea" : draft.kind === "vote" ? "Add a star" : actionTitles[draft.kind] ?? (draft.edit ? "Edit " : "Add ") + labels[draft.kind]}</h2><button type="button" className="quiet" aria-label="Close" disabled={saving} onClick={() => setDraft(undefined)}>×</button></div>
        {draft.context && <p className="meta">{draft.context}</p>}
        {!draft.edit && (name ? <p className="meta">Posting as {name}</p> : <>
          <label>What should we call you?<input name="author" maxLength={50} required autoComplete="nickname" placeholder="First name or nickname" value={nameDraft} onChange={e => setNameDraft(e.target.value)} /></label>
          {suggestions.length > 0 && <div className="name-suggestions" aria-label="Existing team names">{suggestions.map(candidate =>
            <div key={candidate}><span>Are you {candidate} on a different device?</span><button type="button" className="quiet small" disabled={saving} onClick={() => void useName(candidate, true)}>Yes, I’m {candidate}</button></div>
          )}</div>}
        </>)}
        {!draft.identity && draft.kind !== "vote" && <>
          {!untitled(draft.kind) && <label>Title<input name="title" required maxLength={120} defaultValue={draft.edit?.title} /></label>}
          {draft.kind === "problem" && <label>Severity<select name="severity" defaultValue={draft.edit?.severity ?? "medium"}>{severities.map(severity => <option key={severity} value={severity}>{severityLabels[severity]}</option>)}</select></label>}
          <label>{draft.starred ? "Why are you starring this idea?" : actionNotes[draft.kind] ?? (draft.kind === "comment" ? "Comment" : "Description")}<textarea name="body" rows={5} required maxLength={3000} defaultValue={draft.edit?.body} /></label>
        </>}
        {error && <p className="notice" role="alert">{error}</p>}
        <div className="dialog-actions">{draft.edit && <button type="button" className="quiet danger delete-entry" disabled={saving} onClick={() => {
          setConfirmation("");
          setError("");
          setDraft({ ...draft, deleting: true });
        }}>Delete</button>}<button type="button" className="quiet" onClick={() => setDraft(undefined)} disabled={saving}>Cancel</button><button className="primary" disabled={saving || (!name && exactName && !draft.edit)}>{saving ? "Saving…" : draft.identity ? "Set name" : draft.edit ? "Save changes" : draft.starred ? "Post comment and star" : actionSaves[draft.kind] ?? (draft.kind === "comment" ? "Post comment" : "Save " + draft.kind)}</button></div>
      </form>}
    </dialog>
  </>;
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { severities, type Entry, type Kind, type Severity } from "../lib/board";

import { displayNameKey } from "../lib/board-cookies";

type Draft = { kind: Kind; parent?: string; context?: string; edit?: Entry; identity?: boolean; starred?: boolean };
const labels: Record<Kind, string> = { problem: "problem", inspiration: "inspiration", idea: "idea", comment: "comment", test: "test", vote: "star", resolution: "resolution", completion: "completion" };
const actionTitles: Partial<Record<Kind, string>> = { test: "Log a test run", vote: "Star this idea", resolution: "Select as solution", completion: "Mark idea complete" };
const actionNotes: Partial<Record<Kind, string>> = { test: "What did you test, and what happened?", resolution: "Resolution", completion: "What did we do?" };
const actionSaves: Partial<Record<Kind, string>> = { test: "Log test", vote: "Add star", resolution: "Resolve problem", completion: "Mark complete" };
const untitled = (kind: Kind) => ["comment", "test", "vote", "resolution", "completion"].includes(kind);
const update = (list: Entry[], next: Entry[]) => [...new Map([...list, ...next].map(e => [e.id, e])).values()];

const severityLabels: Record<Severity | "resolved", string> = { high: "High", medium: "Medium", low: "Low", resolved: "Resolved" };

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

function EditButton({ entry, disabled, onClick }: { entry: Entry; disabled: boolean; onClick: () => void }) {
  return <button type="button" className="edit-pencil" aria-label={entry.kind === "comment" ? "Edit your comment" : `Edit ${entry.kind}: ${entry.title}`} title={entry.kind === "comment" ? "Edit your comment" : "Edit title and description"} disabled={disabled} onClick={onClick}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/></svg>
  </button>;
}

export default function Board({
  initialEntries, request = fetch, root = "/", logo = "/protostars.jpg",
}: { initialEntries: Entry[]; request?: typeof fetch; root?: string; logo?: string }) {
  const [entries, setEntries] = useState(initialEntries);
  const [tab, setTab] = useState<"problem" | "inspiration">("problem");
  const [selected, setSelected] = useState(initialEntries[0]?.id ?? "");
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
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const boardRevision = useRef(0);
  useEffect(() => {
    let active = true;
    async function refresh() {
      const revision = boardRevision.current;
      try {
        const res = await request("/api/board", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = await res.json() as { entries: Entry[]; displayName: string; ownCommentIds: string[]; knownNames: string[] };
        if (active && revision === boardRevision.current) { setEntries(e => update(e, data.entries)); setReady(true); setName(data.displayName); setOwnCommentIds(data.ownCommentIds ?? []); setKnownNames(data.knownNames ?? []); setNotice(""); }
      } catch { if (active && revision === boardRevision.current) { setReady(false); setNotice("The shared board is unavailable. Reconnecting…"); } }
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
      if (entry.kind === "problem") { setTab("problem"); setSelected(entry.id); setSearch(""); }
      if (entry.kind === "inspiration") { setTab("inspiration"); setSearch(""); }
      if (entry.kind === "idea") setExpanded(ids => [...ids, entry.id]);
      setDraft(undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save. Please try again.";
      if (draft) setError(message); else setNotice(message);
    }
    finally { setSaving(false); }
  }
  async function download() {
    try {
      const response = await request("/api/board", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const { version, team, entries } = await response.json() as { version: number; team: string; entries: Entry[] };
      const blob = new Blob([JSON.stringify({ version, team, entries }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "ftc-17097-debrief.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setNotice("Couldn't download the shared board. Please try again."); }
  }

  const problems = entries.filter(e => e.kind === "problem");
  const ideas = entries.filter(e => e.kind === "idea");
  const inspirations = entries.filter(e => e.kind === "inspiration");
  const childrenOf = (id: string) => ideas.filter(e => e.parent === id);
  const matches = (e: Entry) => (e.title + " " + e.body).toLowerCase().includes(search.trim().toLowerCase());
  const visible = (e: Entry) => matches(e) || childrenOf(e.id).some(matches);
  const outcomes = new Map(entries.filter(e => e.active && (e.kind === "resolution" || e.kind === "completion")).map(e => [e.parent, e]));
  const solutionFor = (id: string) => childrenOf(id).find(idea => outcomes.get(idea.id)?.kind === "resolution");
  const shown = problems.filter(visible);
  const activeProblems = shown.filter(p => !solutionFor(p.id)).sort((a, b) => severities.indexOf(a.severity ?? "medium") - severities.indexOf(b.severity ?? "medium"));
  const solvedProblems = shown.filter(p => solutionFor(p.id));
  const current = shown.find(p => p.id === selected) ?? activeProblems[0] ?? solvedProblems[0];
  const solution = current ? solutionFor(current.id) : undefined;
  const resolution = solution ? outcomes.get(solution.id) : undefined;

  function expand(id: string) {
    setExpanded(ids => ids.includes(id) ? ids : [...ids, id]);
  }

  async function reopen(problem: Entry) {
    if (saving) return;
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
    const outcomeLabel = e.kind === "resolution" ? (e.active ? "Resolution" : "Previous resolution") : e.kind === "completion" ? "Completed" : undefined;
    return <div className="comment" key={e.id}>
      <div className={mine ? "editable-entry" : undefined}>
        {e.starred && <span className="comment-star" role="img" aria-label="Starred this idea" title="Starred this idea">★</span>}
        {outcomeLabel && <span className={e.active ? "outcome-badge" : "history-label"}>{e.active && "✓ "}{outcomeLabel}</span>}
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

  function ideaCards(parent: Entry) {
    const isProblem = parent.kind === "problem";
    const solved = isProblem && Boolean(solutionFor(parent.id));
    const childIdeas = childrenOf(parent.id);
    const shownIdeas = !search || matches(parent) ? childIdeas : childIdeas.filter(matches);
    return <>
      <div className="detail-head"><h3>{isProblem ? "Ideas to test" : "Ideas"}</h3><button className="quiet" disabled={!ready} onClick={() => open({ kind: "idea", parent: parent.id, context: parent.title })}>＋ Add idea</button></div>
      {shownIdeas.map(i => {
        const items = entries.filter(e => e.parent === i.id);
        const comments = items.filter(e => ["comment", "resolution", "completion"].includes(e.kind));
        const tests = items.filter(e => e.kind === "test");
        const votes = items.filter(e => e.starred);
        const hasVoted = Boolean(name) && votes.some(c => displayNameKey(c.author) === displayNameKey(name));
        const isOpen = expanded.includes(i.id);
        const outcome = outcomes.get(i.id);
        const checkLabel = isProblem ? "Selected solution" : "Completed idea";
        return <article className="idea" key={i.id}>
          <div className="idea-header">
            <button className="idea-title" aria-expanded={isOpen} aria-controls={"idea-" + i.id} onClick={() => setExpanded(ids => isOpen ? ids.filter(id => id !== i.id) : [...ids, i.id])}>
              <span className="chevron" aria-hidden="true">{isOpen ? "−" : "+"}</span><strong>{i.title}</strong><small>{comments.length} {comments.length === 1 ? "comment" : "comments"}</small>
            </button>
            {outcome && <span className="idea-check" role="img" aria-label={checkLabel} title={checkLabel}>✓</span>}
            {isProblem && <button type="button" className="test-count" aria-label={`${tests.length} ${tests.length === 1 ? "test run" : "test runs"} for ${i.title}`} title="View test runs" onClick={() => expand(i.id)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v7L4.5 19a1 1 0 0 0 1 2h13a1 1 0 0 0 1-2L14 10V3M8 15h8"/></svg>{tests.length}
            </button>}
            <button type="button" className="star-button" aria-label={`${hasVoted ? "You starred" : "Star"} ${i.title}. ${votes.length} ${votes.length === 1 ? "star" : "stars"}`} aria-pressed={hasVoted} title={hasVoted ? "You already starred this idea" : isProblem ? "Star this idea and explain why" : "Star this idea"} disabled={!ready || hasVoted || saving} onClick={() => {
              const vote: Draft = {kind: isProblem ? "comment" : "vote", parent: i.id, context: i.title, starred: isProblem};
              if (isProblem) expand(i.id);
              if (isProblem || !name) open(vote); else void saveContribution(vote);
            }}><span aria-hidden="true">{hasVoted ? "★" : "☆"}</span>{votes.length}</button>
          </div>
          <div id={"idea-" + i.id} hidden={!isOpen} className="idea-body">
            <div className="editable-entry idea-description"><p className="body">{i.body}</p><p className="meta">{i.author}</p><EditButton entry={i} disabled={!ready} onClick={() => edit(i)} /></div>
            {discussion(i, comments)}
            {isProblem && <section className="discussion">
              <div className="discussion-head"><h4>Tests</h4><button className="quiet small" disabled={!ready} onClick={() => open({kind: "test", parent: i.id, context: i.title})}>＋ Log test</button></div>
              {!tests.length && <p className="meta">No test runs logged yet.</p>}
              {tests.map(logEntry)}
            </section>}
            {((isProblem && !solved) || (!isProblem && !outcome)) && <div className="outcome-actions"><button className="quiet small" disabled={!ready} onClick={() => open({kind: isProblem ? "resolution" : "completion", parent: i.id, context: i.title})}>{isProblem ? "Select as solution" : "Mark complete"}</button></div>}
          </div>
        </article>;
      })}
      {!childIdeas.length && <p className="empty">No ideas yet. Add something the team could try.</p>}
    </>;
  }

  function problemLinks(items: Entry[], solved: boolean) {
    return items.map(p => <button key={p.id} className={current?.id === p.id ? "selected" : ""} aria-pressed={current?.id === p.id} onClick={() => setSelected(p.id)}>
      <span className="problem-link-label"><ProblemStatus status={solved ? "resolved" : p.severity ?? "medium"} /><span>{p.title}</span></span><small>{childrenOf(p.id).length}</small>
    </button>);
  }
  return <>
    <header className="top"><div className="wrap bar">
      <a href={root} className="brand"><img src={logo} width="48" height="48" alt="" /><span>Protostars<small>FIRST TECH CHALLENGE · TEAM 17097</small></span></a>
      <div className="tools header-tools">{!name && <button className="quiet" disabled={!ready} onClick={() => open({kind: "comment", identity: true})}>Set display name</button>}
      <button className="quiet" onClick={download} disabled={!ready}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/></svg> Download JSON</button></div>
    </div></header>
    <main className="wrap">
      <section className="hero">
        <div><div className="eyebrow">BIOBUZZ / COMPETITION NOTES</div><h1>Robot debrief<span>.</span></h1><p>Here’s what we wrote down during walkarounds and right after the competition. Add what you noticed, share ideas to test, and tell us what you saw other teams doing.</p></div>
        <div className="stats"><div><strong>{problems.length}</strong><span>Problems</span></div><div><strong>{ideas.length}</strong><span>Ideas</span></div><div><strong>{inspirations.length}</strong><span>Inspirations</span></div></div>
      </section>
      {notice && <p className="notice" role="status">{notice}</p>}
      <section className="toolbar" aria-label="Board controls">
        <div className="tabs"><button className={tab === "problem" ? "active" : ""} aria-pressed={tab === "problem"} onClick={() => {setTab("problem"); setSearch("");}}>Problems &amp; ideas</button><button className={tab === "inspiration" ? "active" : ""} aria-pressed={tab === "inspiration"} onClick={() => {setTab("inspiration"); setSearch("");}}>Inspiration</button></div>
        <div className="tools"><input type="search" placeholder={tab === "problem" ? "Find a problem or idea" : "Find inspiration"} aria-label="Search current section" value={search} onChange={e => setSearch(e.target.value)} /><button className="primary" disabled={!ready} onClick={() => open({ kind: tab })}>＋ {tab === "problem" ? "Add problem" : "Add inspiration"}</button></div>
      </section>
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
        {current && <section className="detail" aria-label="Selected problem">
          <div className="editable-entry">
            <div className="problem-meta"><span className="eyebrow">PROBLEM</span><ProblemStatus status={resolution ? "resolved" : current.severity ?? "medium"} full /></div><h2>{current.title}</h2><p className="body">{current.body}</p>
            <EditButton entry={current} disabled={!ready} onClick={() => edit(current)} />
          </div>
          {current.author !== "Competition debrief" && <p className="meta">Added by {current.author}</p>}
          {resolution && solution && <div className="resolution-panel">
            <div className="discussion-head"><h3>✓ Resolution</h3><button className="quiet small" disabled={!ready || saving || !name} onClick={() => void reopen(current)}>Reopen problem</button></div>
            <button type="button" className="quiet small" onClick={() => expand(solution.id)}>{solution.title}</button>
            <p className="body">{resolution.body}</p><p className="meta">Resolved by {resolution.author}</p>
          </div>}
          {ideaCards(current)}
        </section>}
      </div> : <section className="inspiration"><h2>Things we saw</h2><p className="body">What did other teams build or do that we should talk about? Pit setups and match strategies count too.</p>
        <div className="inspiration-grid">{inspirations.filter(visible).map(i => <article className="inspiration-card" key={i.id}>
          <div className="editable-entry"><div className="eyebrow">INSPIRATION</div><h3>{i.title}</h3><p className="body">{i.body}</p><p className="meta">{i.author}</p><EditButton entry={i} disabled={!ready} onClick={() => edit(i)} /></div>
          {discussion(i, entries.filter(e => e.kind === "comment" && e.parent === i.id))}
          {ideaCards(i)}
        </article>)}</div>
        {!inspirations.some(visible) && <p className="empty">No matching inspiration.</p>}
      </section>}
      <footer>Protostars · Team 17097 <span> / </span> Bring a different idea. We’ll compare what works.</footer>
    </main>
    <dialog ref={dialog} onCancel={e => {e.preventDefault(); if (!saving) setDraft(undefined);}}>
      {draft && <form key={draft.edit?.id ?? draft.kind + (draft.parent ?? "")} onSubmit={submit}>
        <div className="dialog-head"><h2>{draft.identity ? "Set display name" : draft.starred ? "Star this idea" : actionTitles[draft.kind] ?? (draft.edit ? "Edit " : "Add ") + labels[draft.kind]}</h2><button type="button" className="quiet" aria-label="Close" disabled={saving} onClick={() => setDraft(undefined)}>×</button></div>
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
        <div className="dialog-actions"><button type="button" className="quiet" onClick={() => setDraft(undefined)} disabled={saving}>Cancel</button><button className="primary" disabled={saving || (!name && exactName && !draft.edit)}>{saving ? "Saving…" : draft.identity ? "Set name" : draft.edit ? "Save changes" : draft.starred ? "Post comment and star" : actionSaves[draft.kind] ?? (draft.kind === "comment" ? "Post comment" : "Save " + draft.kind)}</button></div>
      </form>}
    </dialog>
  </>;
}

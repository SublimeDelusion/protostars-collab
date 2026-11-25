"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Board from "./board";
import { CLAIM_HEADER, INVITE_HEADER, NAME_HEADER } from "../lib/pages-origin";
import type { AccessState } from "../lib/team-access";

const backend = "https://ftc-17097-debrief.hopefulbeam4.chatgpt.site";
const sessionKey = "protostars-invite";
const pendingKey = "__Host-workshop-pending";
const nameKey = "protostars-name";

function pendingCookie() {
  return document.cookie.split("; ").find(value => value.startsWith(pendingKey + "="))?.slice(pendingKey.length + 1) ?? "";
}
function setPendingCookie(value: string) {
  document.cookie = pendingKey + "=" + value + "; Path=/; SameSite=Lax; Secure; Max-Age=" + (value ? 31536000 : 0);
}

const messages = {
  pending: "An active teammate can approve your request from the Team tab. This browser will open the Workshop automatically when they do.",
  declined: "Your request was declined. You can submit another request below.",
  suspended: "Your access is temporarily suspended. Another active teammate can restore it from the Team tab.",
  removed: "Your access was removed. You can contact your team or submit a new request.",
};

export default function WorkshopClient({ pages = false }: { pages?: boolean }) {
  const [state, setState] = useState<AccessState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");
  const [welcome, setWelcome] = useState("");
  const [team, setTeam] = useState("");
  const [teams, setTeams] = useState<{ name: string; number: string }[]>();
  const [existing, setExisting] = useState(false);

  const send = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!pages) return fetch(input, init);
    const headers = new Headers(init?.headers);
    const key = pendingCookie() || localStorage.getItem(sessionKey) || "";
    if (key) {
      headers.set(INVITE_HEADER, key);
      const name = localStorage.getItem(nameKey + ":" + key);
      if (name) headers.set(NAME_HEADER, name);
    }
    const response = await fetch(backend + input, { ...init, headers, credentials: "omit" });
    const name = response.headers.get(NAME_HEADER);
    if (key && name) localStorage.setItem(nameKey + ":" + key, name);
    // Older Protostars clients saved the name before credentials were scoped per team.
    if (key && input === "/api/board" && response.ok && !headers.has(NAME_HEADER) && !name) {
      const previous = localStorage.getItem(nameKey);
      if (previous && (await response.clone().json() as { team: string }).team === "17097") {
        localStorage.setItem(nameKey + ":" + key, previous);
      }
    }
    return response;
  }, [pages]);

  const checkAccess = useCallback(async () => {
    try {
      const response = await send("/api/team?view=status");
      if (!response.ok) throw new Error();
      const { state } = await response.json() as { state: AccessState };
      if (pages && state === "active" && pendingCookie()) {
        localStorage.setItem(sessionKey, pendingCookie());
        setPendingCookie("");
      }
      setState(state);
    } catch {
      setError("Couldn’t check your access. Try refreshing.");
    }
  }, [pages, send]);

  useEffect(() => {
    const checkLink = () => setInvite(new URLSearchParams(location.hash.slice(1)).get("invite") ?? "");
    checkLink();
    void checkAccess();
    window.addEventListener("hashchange", checkLink);
    window.addEventListener("focus", checkAccess);
    const timer = setInterval(checkAccess, 5000);
    return () => {
      window.removeEventListener("hashchange", checkLink);
      window.removeEventListener("focus", checkAccess);
      clearInterval(timer);
    };
  }, [checkAccess]);

  useEffect(() => {
    if (state === undefined || state === "active" || teams) return;
    let live = true;
    void send("/api/team?view=teams").then(async response => {
      if (!response.ok) throw new Error();
      if (live) setTeams((await response.json() as { teams: typeof teams }).teams);
    }).catch(() => { if (live) setError("Couldn’t load the team list. Try refreshing."); });
    return () => { live = false; };
  }, [state, teams, send]);

  function dismissInvite() {
    history.replaceState(history.state, "", location.pathname + location.search);
    setInvite("");
  }

  async function exchange(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const storage = input.action === "redeem" ? sessionKey + ":claim" : sessionKey + ":request";
    const candidate = pages ? sessionStorage.getItem(storage) ?? crypto.randomUUID() + crypto.randomUUID() : "";
    if (pages) sessionStorage.setItem(storage, candidate);
    try {
      const response = await send("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(pages ? { [CLAIM_HEADER]: candidate } : {}) },
        body: JSON.stringify(input),
      });
      const result = await response.json() as { state: AccessState; error?: string; message?: string };
      if (!response.ok) {
        if (pages && response.status < 500) sessionStorage.removeItem(storage);
        throw new Error(result.error || "Couldn’t connect. Try again.");
      }
      if (pages) {
        if (result.state === "active") {
          setPendingCookie("");
          localStorage.setItem(sessionKey, candidate);
        } else {
          setPendingCookie(candidate);
        }
        sessionStorage.removeItem(storage);
      }
      setWelcome(result.message ?? "");
      setState(result.state);
      dismissInvite();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn’t connect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void exchange({ action: "request-access", team, teamNumber: fields.get("teamNumber"), name: fields.get("name"),
      email: fields.get("email"), existing });
  }

  if (state === "active" && !invite) {
    return <Board initialEntries={[]} request={send} root={pages ? "./" : "/"} assetOrigin={pages ? backend : ""}
      welcome={welcome} dismissWelcome={() => setWelcome("")} onAccessChange={checkAccess} />;
  }
  const showForm = !invite && state && state !== "pending" && state !== "suspended";
  return <>
    <header className="top"><div className="wrap bar"><a href={pages ? "./" : "/"} className="brand"><img src={pages ? "./protostars.jpg" : "/teams/17097/logo.jpg"} width="48" height="48" alt="" /><span>Protostars<small>FIRST TECH CHALLENGE · TEAM 17097</small></span></a></div></header>
    <main className="wrap">
      <section className="hero"><div><h1>FTC Workshop</h1><p className="workshop-credit">by Team 17097 Protostars</p></div></section>
      {error && <p className="notice" role="alert">{error}</p>}
      {invite ? <section className="detail pages-invite">
        <h2>Workshop invitation</h2>
        <div className="team-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void exchange({ action: "redeem", token: invite })}>Accept invite</button>
          <button type="button" className="quiet" disabled={busy} onClick={dismissInvite}>{state === "active" ? "Back to Workshop" : "Request access"}</button>
        </div>
      </section> : state === undefined ? <p role="status">Checking Workshop access…</p> : <>
        {state in messages && <section className="detail pages-invite">
          <h2>{{ pending: "Access pending", declined: "Access declined", suspended: "Access suspended", removed: "Access removed" }[state as keyof typeof messages]}</h2>
          <p role="status">{messages[state as keyof typeof messages]}</p>
        </section>}
        {showForm && <section className="detail pages-invite">
          <h2>Request access</h2>
          <form onSubmit={submit}>
            <label>Request type<select value={existing ? "existing" : "new"} onChange={event => setExisting(event.target.value === "existing")}>
              <option value="new">I’m new to this team</option><option value="existing">I’m already a member and lost access</option>
            </select></label>
            <label>Team<select required value={team} onChange={event => setTeam(event.target.value)}>
              <option value="">Choose your team</option>
              {teams?.map(option => <option key={option.number} value={option.number}>{option.name}</option>)}
            </select></label>
            <label>FTC team number<input name="teamNumber" required inputMode="numeric" pattern="[0-9]+" maxLength={12} /></label>
            <label>Display name<input name="name" required autoComplete="given-name" maxLength={50} /></label>
            <label>Email (optional)<input name="email" type="email" autoComplete="email" maxLength={254} /></label>
            <button className="primary" disabled={busy || !teams?.length}>{busy ? "Sending…" : "Request access"}</button>
          </form>
        </section>}
      </>}
    </main>
  </>;
}

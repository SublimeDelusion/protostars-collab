import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Board from "../app/board";
import { INVITE_HEADER, NAME_HEADER } from "../lib/pages-origin";
import "../app/globals.css";

const backend = "https://ftc-17097-debrief.hopefulbeam4.chatgpt.site";
const inviteKey = "protostars-invite";
const nameKey = "protostars-name";

function requestFor(key: string): typeof fetch {
  const teamNameKey = nameKey + ":" + key;
  let name = localStorage.getItem(teamNameKey) ?? "";
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(INVITE_HEADER, key);
    if (name) headers.set(NAME_HEADER, name);
    const response = await fetch(backend + input, { ...init, headers, credentials: "omit" });
    const updatedName = response.headers.get(NAME_HEADER);
    if (updatedName) {
      name = updatedName;
      localStorage.setItem(teamNameKey, name);
    } else if (!name && response.ok && (!init?.method || init.method === "GET")) {
      const previous = localStorage.getItem(nameKey);
      if (previous && (await response.clone().json() as { team: string }).team === "17097") {
        name = previous;
        localStorage.setItem(teamNameKey, name);
      }
    }
    return response;
  };
}

function validKey(value: string | null): value is string {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value ?? "");
}

function Pages() {
  const connection = useRef(0);
  const [request, setRequest] = useState<typeof fetch>();
  const [status, setStatus] = useState("");
  const [initialKey] = useState(() => {
    const invite = new URLSearchParams(location.hash.slice(1)).get("invite");
    const saved = localStorage.getItem(inviteKey);
    if (invite !== null) return validKey(invite) ? invite : null;
    return validKey(saved) ? saved : null;
  });
  const [busy, setBusy] = useState(Boolean(initialKey));
  useEffect(() => {
    if (initialKey) void connect(initialKey);
    const switchTeam = () => {
      const invite = new URLSearchParams(location.hash.slice(1)).get("invite");
      if (validKey(invite)) void connect(invite);
    };
    window.addEventListener("hashchange", switchTeam);
    return () => window.removeEventListener("hashchange", switchTeam);
  }, [initialKey]);

  async function connect(key: string) {
    const attempt = ++connection.current;
    setRequest(undefined);
    setStatus("");
    setBusy(true);
    try {
      const send = requestFor(key);
      const response = await send("/api/board");
      if (connection.current !== attempt) return;
      if (response.status === 404) {
        if (localStorage.getItem(inviteKey) === key) localStorage.removeItem(inviteKey);
        setStatus("This invite didn’t work. Ask your team for the current link.");
        return;
      }
      if (!response.ok) throw new Error();
      localStorage.setItem(inviteKey, key);
      if (new URLSearchParams(location.hash.slice(1)).has("invite")) {
        history.replaceState(history.state, "", location.pathname + location.search);
      }
      setRequest(() => send);
    } catch {
      if (connection.current === attempt) setStatus("Couldn’t connect to the board. Refresh to try again.");
    } finally { if (connection.current === attempt) setBusy(false); }
  }
  if (request) return <Board initialEntries={[]} request={request} root="./" assetOrigin={backend} />;
  return <>
    <header className="top"><div className="wrap bar"><a href="./" className="brand"><img src="./protostars.jpg" width="48" height="48" alt="" /><span>Protostars<small>FIRST TECH CHALLENGE · TEAM 17097</small></span></a></div></header>
    <main className="wrap">
      <section className="hero"><div><h1>FTC Workshop</h1><p className="workshop-credit">By the Protostars 17097</p></div></section>
      {busy ? <p role="status">Opening your team board…</p> : <>
        {status && <p className="notice" role="status">{status}</p>}
        <section className="detail pages-invite">
          <h2>Request access</h2>
          <p className="body">Want your own board? Tell us about your team.</p>
          <form onSubmit={event => event.preventDefault()}>
            <label>Team name<input name="teamName" required maxLength={120} /></label>
            <label>Team number<input name="teamNumber" required inputMode="numeric" pattern="[0-9]+" maxLength={12} /></label>
            <label>Contact email<input name="email" type="email" required maxLength={254} /></label>
            <label>Message<textarea name="message" rows={4} maxLength={3000} /></label>
            <p className="meta">Email delivery is coming soon.</p>
            <button className="primary" type="submit" disabled>Send request</button>
          </form>
        </section>
      </>}
    </main>
  </>;
}

createRoot(document.getElementById("root")!).render(<Pages />);

import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import Board from "../app/board";
import { INVITE_HEADER, NAME_HEADER } from "../lib/pages-origin";
import "../app/globals.css";

const backend = "https://ftc-17097-debrief.hopefulbeam4.chatgpt.site";
const inviteKey = "protostars-invite";
const nameKey = "protostars-name";

function requestFor(key: string): typeof fetch {
  let name = localStorage.getItem(nameKey) ?? "";
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(INVITE_HEADER, key);
    if (name) headers.set(NAME_HEADER, name);
    const response = await fetch(backend + input, { ...init, headers, credentials: "omit" });
    const updatedName = response.headers.get(NAME_HEADER);
    if (updatedName) {
      name = updatedName;
      localStorage.setItem(nameKey, name);
    }
    return response;
  };
}

function validKey(value: string | null): value is string {
  return /^[A-Za-z0-9_-]{32}$/.test(value ?? "");
}

function Pages() {
  const [request, setRequest] = useState<typeof fetch>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [initialKey] = useState(() => {
    const invite = new URLSearchParams(location.hash.slice(1)).get("invite");
    const saved = localStorage.getItem(inviteKey);
    return validKey(invite) ? invite : validKey(saved) ? saved : null;
  });
  useEffect(() => {
    if (initialKey) void connect(initialKey);
  }, [initialKey]);

  async function connect(key: string) {
    setMessage("");
    setBusy(true);
    try {
      const send = requestFor(key);
      const response = await send("/api/board");
      if (response.status === 404) {
        if (localStorage.getItem(inviteKey) === key) localStorage.removeItem(inviteKey);
        setMessage("This invite didn’t work. Ask the team for the current link.");
        return;
      }
      if (!response.ok) throw new Error();
      if (localStorage.getItem(inviteKey) !== key) localStorage.setItem(inviteKey, key);
      if (new URLSearchParams(location.hash.slice(1)).has("invite")) {
        history.replaceState(history.state, "", location.pathname + location.search);
      }
      setRequest(() => send);
    } catch {
      setMessage("Couldn’t connect to the board. Try again in a moment.");
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = String(new FormData(event.currentTarget).get("invite") ?? "").trim();
    const key = value || initialKey;
    if (!validKey(key)) {
      setMessage("Enter your team invite code or open the invite link.");
      return;
    }
    void connect(key);
  }
  if (request) return <Board initialEntries={[]} request={request} root="./" logo="./protostars.jpg" />;
  return <>
    <header className="top"><div className="wrap bar"><a href="./" className="brand"><img src="./protostars.jpg" width="48" height="48" alt="" /><span>Protostars<small>FIRST TECH CHALLENGE · TEAM 17097</small></span></a></div></header>
    <main className="wrap"><section className="hero"><div><h1>Robot debrief<span>.</span></h1><p>Open the team’s shared board with your invite link.</p></div></section>
      <form className="detail pages-invite" onSubmit={submit}><label htmlFor="invite">Team invite code</label><input id="invite" name="invite" type="text" autoCapitalize="none" spellCheck={false} required={!initialKey} placeholder="Enter the team invite code" /><button className="primary" disabled={busy}>{busy ? "Connecting…" : "Open board"}</button>{message && <p role="alert">{message}</p>}</form>
    </main>
  </>;
}

createRoot(document.getElementById("root")!).render(<Pages />);

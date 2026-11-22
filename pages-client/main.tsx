import { useState, type FormEvent } from "react";
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

function Pages() {
  const [request, setRequest] = useState<typeof fetch>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(() => localStorage.getItem(inviteKey));
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = String(new FormData(event.currentTarget).get("invite") ?? "").trim();
    setMessage("");
    let key: string;
    if (!value && saved) {
      key = saved;
    } else {
      try {
        const link = new URL(value);
        const match = /^\/join\/([A-Za-z0-9_-]{32})\/?$/.exec(link.pathname);
        if (link.origin !== backend || !match) throw new Error();
        key = match[1];
      } catch { setMessage("Paste the team invite link."); return; }
    }
    setBusy(true);
    try {
      const send = requestFor(key);
      const response = await send("/api/board");
      if (response.status === 404) {
        localStorage.removeItem(inviteKey);
        setSaved(null);
        setMessage("This invite didn’t work. Ask the team for the current link.");
        return;
      }
      if (!response.ok) throw new Error();
      localStorage.setItem(inviteKey, key);
      setRequest(() => send);
    } catch {
      setMessage("Couldn’t connect to the board. Try again in a moment.");
    } finally { setBusy(false); }
  }
  if (request) return <Board initialEntries={[]} request={request} root="./" logo="./protostars.jpg" />;
  return <>
    <header className="top"><div className="wrap bar"><a href="./" className="brand"><img src="./protostars.jpg" width="48" height="48" alt="" /><span>Protostars<small>FIRST TECH CHALLENGE · TEAM 17097</small></span></a></div></header>
    <main className="wrap"><section className="hero"><div><h1>Robot debrief<span>.</span></h1><p>Open the team’s shared board with your invite link.</p></div></section>
      <form className="detail pages-invite" onSubmit={connect}><label htmlFor="invite">Team invite link</label><input id="invite" name="invite" type="url" required={!saved} placeholder={saved ? "Saved on this device" : "Paste the team invite link"} /><button className="primary" disabled={busy}>{busy ? "Connecting…" : "Open board"}</button>{message && <p role="alert">{message}</p>}</form>
    </main>
  </>;
}

createRoot(document.getElementById("root")!).render(<Pages />);

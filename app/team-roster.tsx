"use client";

import type { FormEvent } from "react";
import type { TeamRoster } from "../lib/team-access";

export default function TeamMembers({ roster, busy, error, act }: {
  roster?: TeamRoster;
  busy: boolean;
  error: string;
  act: (action: string, fields: Record<string, unknown>, invite?: boolean) => Promise<boolean>;
}) {
  if (!roster) return <p role="status">{error || "Loading team…"}</p>;
  const activeMembers = roster.members.filter(member => member.state === "active" && !member.removalUntil);
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void act("invite-teammate", { name: new FormData(form).get("name") }, true).then(ok => { if (ok) form.reset(); });
  }
  return <div className="team-panels">
    {error && <p className="notice" role="alert">{error}</p>}
    <section className="detail">
      <h3>Access requests</h3>
      {roster.requests.length ? <ul className="team-list">{roster.requests.map(request => <li key={request.id}>
        <form className="team-row" onSubmit={event => {
          event.preventDefault();
          const memberId = new FormData(event.currentTarget).get("memberId");
          void act("approve", { id: request.id, memberId });
        }}>
          <div><strong>{request.name}</strong><div className="meta">{request.existing ? "Recover access" : "New teammate"}{request.email ? " · " + request.email : ""}</div></div>
          <div className="team-actions">
            {request.existing && <label className="team-match">Link to existing member
              <select name="memberId" required disabled={!roster.viewer || busy} defaultValue="">
                <option value="">Choose member</option>
                {activeMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>}
            <button className="primary" disabled={!roster.viewer || busy}>Approve</button>
            <button type="button" className="quiet" disabled={!roster.viewer || busy} onClick={() => void act("decline", { id: request.id })}>Decline</button>
          </div>
        </form>
      </li>)}</ul> : <p className="meta">No pending access requests.</p>}
    </section>
    <section className="detail">
      <h3>Team members</h3>
      {!roster.viewer && <p className="notice">Set your display name to manage team access and invitations.</p>}
      <form className="team-row team-add" onSubmit={add}>
        <label>Teammate name<input name="name" required maxLength={50} autoComplete="off" /></label>
        <button className="primary" disabled={!roster.viewer || busy}>Add teammate</button>
      </form>
      {roster.members.length > 0 && <ul className="team-list">{roster.members.map(member => {
        const self = member.id === roster.viewer;
        const proposer = roster.members.find(item => item.id === member.removalBy);
        return <li className="team-row" key={member.id}>
          <div><strong>{member.name}</strong>
            <div className="meta">{self ? "You" : member.state === "invited" ? "Pending invite" : member.removalUntil ? "Suspended" : "Joined"}</div>
            {member.removalUntil && <div className="meta">Proposed by {proposer?.name ?? "a teammate"}. Access returns {new Date(member.removalUntil).toLocaleDateString()} if nobody confirms.</div>}
          </div>
          {roster.viewer && <div className="team-actions">
            {member.state === "invited"
              ? <button type="button" className="quiet" disabled={busy} onClick={() => void act("invite-teammate", { memberId: member.id }, true)}>Reshare invite</button>
              : member.removalUntil ? member.removalBy !== roster.viewer && <>
                <button type="button" className="quiet" disabled={busy} onClick={() => void act("restore-member", { memberId: member.id })}>Restore access</button>
                <button type="button" className="quiet team-danger" disabled={busy} onClick={() => {
                  if (window.confirm(`Confirm removal of ${member.name}? Their contributions will stay on the board.`)) void act("confirm-removal", { memberId: member.id });
                }}>Confirm removal</button>
              </> : <>
                <button type="button" className="quiet" disabled={busy} onClick={() => void act(self ? "add-device" : "invite-device", { memberId: member.id }, true)}>{self ? "Add a device" : "Device invite"}</button>
                {!self && <button type="button" className="quiet team-danger" disabled={busy} onClick={() => {
                  if (window.confirm(`Suspend ${member.name} now? A second teammate can confirm removal or restore access.`)) void act("propose-removal", { memberId: member.id });
                }}>Propose removal</button>}
              </>}
          </div>}
        </li>;
      })}</ul>}
    </section>
  </div>;
}

import { boardCookie, BOARD_COOKIE, displayNameKey, normalizeDisplayName } from "../lib/board-cookies";
import { workshopInviteLink, CLAIM_HEADER } from "../lib/pages-origin";
import type { AccessState, JoinRequest, Member } from "../lib/team-access";
import { claimTeamInvite, hashToken, newBoardToken, registeredTeam, validBoardToken } from "../lib/team-invites";
import { teams } from "../lib/teams";
import { drizzle } from "drizzle-orm/d1";

const week = 7 * 24 * 60 * 60 * 1000;
const deviceLifetime = 30 * 60 * 1000;
const memberColumns = "id, name, state, removal_by as removalBy, removal_until as removalUntil";

export async function browserAccess(db: D1Database, token: string, legacyName: string) {
  if (!validBoardToken(token)) return { state: "guest" as const };
  const hash = await hashToken(token);
  const member = () => db.prepare(`select m.team, ${memberColumns} from member_sessions s
    join team_members m on m.id = s.member_id where s.token_hash = ?`).bind(hash).first<Member & { team: string }>();
  let current = await member();
  const legacy = current ? null : await db.prepare("select team from team_sessions where token_hash = ?").bind(hash).first<string>("team");
  if (legacy && legacyName) {
    const key = displayNameKey(legacyName);
    const previous = await db.prepare(`select coalesce(n.key,p.key) as key, coalesce(n.name,p.name) as name
      from people p left join people n on n.team = p.team and n.key = p.renamed_to
      where p.team = ? and p.key = ?`).bind(legacy, key).first<{ key: string; name: string }>();
    if (previous) {
      await db.batch([
        db.prepare("insert into team_members (id,team,name_key,name,state) values (?,?,?,?,'active') on conflict(team,name_key) do nothing")
          .bind(crypto.randomUUID(), legacy, previous.key, previous.name),
        db.prepare(`insert into member_sessions (token_hash,member_id)
          select ?,id from team_members where team = ? and name_key = ? and state != 'invited' on conflict do nothing`)
          .bind(hash, legacy, previous.key),
      ]);
      current = await member();
    }
  }
  if (current) {
    const state: AccessState = current.state === "removed" ? "removed"
      : Number(current.removalUntil) > Date.now() ? "suspended" : "active";
    return { state, current, hash, teamNumber: current.team };
  }
  if (legacy) return { state: "active" as const, hash, teamNumber: legacy };
  const pending = await db.prepare("select state from access_requests where token_hash = ?").bind(hash).first<"pending" | "declined">("state");
  return { state: pending ?? "guest", hash };
}

type BrowserAccess = Awaited<ReturnType<typeof browserAccess>>;
type Actor = Member & { team: string };
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const json = (value: unknown) => Response.json(value);
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";

function sessionResponse(state: "active" | "pending", token: string, pages: boolean, message?: string) {
  return Response.json({ state, ...(message ? { message } : {}) }, {
    headers: pages ? {} : { "Set-Cookie": boardCookie(BOARD_COOKIE, token) },
  });
}

async function roster(db: D1Database, team: string, viewer: string | null) {
  const [members, requests] = await db.batch<Member | JoinRequest>([
    db.prepare(`select ${memberColumns} from team_members where team = ? and state != 'removed' order by name collate nocase`).bind(team),
    db.prepare("select id,name,email,existing,created from access_requests where team = ? and state = 'pending' order by created").bind(team),
  ]);
  const now = Date.now();
  const list = (members.results as Member[]).map(member => Number(member.removalUntil) > now
    ? member : { ...member, removalUntil: null, removalBy: null });
  return { members: list, requests: requests.results, viewer,
    badge: requests.results.length + list.filter(member => member.removalUntil && member.removalBy !== viewer).length };
}

async function requestAccess(db: D1Database, session: string, input: Record<string, unknown>, pages: boolean) {
  const name = normalizeDisplayName(str(input.name));
  const key = displayNameKey(name);
  const team = str(input.team);
  const email = str(input.email);
  if (!key || key === "competition debrief" || name.length > 50) return error("Enter a display name between 1 and 50 characters.");
  if (!/^\d{1,12}$/.test(team) || team !== str(input.teamNumber) || !await registeredTeam(drizzle(db), team)) {
    return error("Enter the FTC number for the team you selected.");
  }
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return error("Enter a valid email address.");
  const hash = await hashToken(session);
  const row = await db.prepare(`insert into access_requests (token_hash,id,team,name,name_key,email,existing,state,created)
    values (?,?,?,?,?,?,?,'pending',?) on conflict(token_hash) do nothing returning id`)
    .bind(hash, crypto.randomUUID(), team, name, key, email || null, input.existing === true ? 1 : 0, Date.now()).first();
  const state = row ? "pending" : (await browserAccess(db, session, "")).state;
  return state === "pending" || state === "active" ? sessionResponse(state, session, pages) : error("Start a new access request.", 409);
}

async function decideRequest(db: D1Database, actor: Actor, input: Record<string, unknown>) {
  const id = str(input.id);
  const request = await db.prepare(`select token_hash as hash,name,name_key as nameKey,existing from access_requests
    where id = ? and team = ? and state = 'pending'`).bind(id, actor.team)
    .first<{ hash: string; name: string; nameKey: string; existing: number }>();
  if (!request) return error("This request has already been reviewed.", 409);
  if (input.action === "decline") {
    await db.prepare("update access_requests set state = 'declined' where id = ? and team = ? and state = 'pending'").bind(id, actor.team).run();
    return json({ ok: true });
  }
  let memberId = str(input.memberId);
  const operations: D1PreparedStatement[] = [];
  if (request.existing) {
    const match = await db.prepare(`select id from team_members where id = ? and team = ? and state = 'active'
      and coalesce(removal_until, 0) <= ?`).bind(memberId, actor.team, Date.now()).first();
    if (!match) return error("Select an active roster member before approving this device.");
  } else {
    memberId = crypto.randomUUID();
    operations.push(db.prepare(`insert into team_members (id,team,name_key,name,state)
      select ?,?,?,?,'active' where exists (select 1 from access_requests where id = ? and state = 'pending')
      and not exists (select 1 from people where team = ? and key = ?) on conflict(team,name_key) do nothing`)
      .bind(memberId, actor.team, request.nameKey, request.name, id, actor.team, request.nameKey));
  }
  const now = Date.now();
  operations.push(
    db.prepare(`insert into member_sessions (token_hash,member_id) select r.token_hash,m.id from access_requests r
      join team_members m on m.team = r.team where r.id = ? and r.state = 'pending' and m.id = ?
      and m.state = 'active' and coalesce(m.removal_until,0) <= ? on conflict do nothing`).bind(id, memberId, now),
    db.prepare(`insert into people(team,key,name) select m.team,m.name_key,m.name from team_members m
      join member_sessions s on s.member_id = m.id where s.token_hash = ? and m.id = ? on conflict do nothing`).bind(request.hash, memberId),
    db.prepare(`update access_requests set state = 'approved' where id = ? and state = 'pending'
      and exists (select 1 from member_sessions where token_hash = access_requests.token_hash and member_id = ?) returning id`).bind(id, memberId),
  );
  const results = await db.batch(operations);
  return results.at(-1)?.results.length ? json({ ok: true })
    : error("This request changed or the name is already in use. Ask the teammate to submit a recovery request or use a different name.", 409);
}

async function issueMemberInvite(db: D1Database, actor: Actor, input: Record<string, unknown>) {
  const name = normalizeDisplayName(str(input.name));
  const key = displayNameKey(name);
  let id = str(input.memberId);
  if (input.action === "invite-teammate" && !id) {
    if (!key || key === "competition debrief" || name.length > 50) return error("Enter a teammate name between 1 and 50 characters.");
    const pending = await db.prepare(`insert into team_members (id,team,name_key,name,state)
      select ?,?,?,?,'invited' where not exists (select 1 from people where team = ? and key = ?)
      on conflict(team,name_key) do update set name = team_members.name where team_members.state = 'invited' returning id`)
      .bind(crypto.randomUUID(), actor.team, key, name, actor.team, key).first<string>("id");
    if (!pending) return error("That name is taken. Use Device invite for an existing member.", 409);
    id = pending;
  }
  const device = input.action !== "invite-teammate";
  if (input.action === "add-device") id = actor.id;
  const token = newBoardToken();
  const now = Date.now();
  const saved = await db.prepare(`insert into member_invites (token_hash,member_id,expires,kind)
    select ?,id,?,? from team_members where id = ? and team = ? and state = ?
    and coalesce(removal_until,0) <= ? returning member_id`).bind(
      await hashToken(token), now + (device ? deviceLifetime : week), device ? "device" : "teammate",
      id, actor.team, device ? "active" : "invited", now,
    ).first();
  return saved ? json({ url: workshopInviteLink(token) }) : error("This teammate is no longer eligible for an invite.", 409);
}

async function redeem(db: D1Database, session: string, token: string, pages: boolean) {
  if (!validBoardToken(token) || token === session) return error("This invite is unavailable.", 404);
  const [tokenHash, sessionHash] = await Promise.all([hashToken(token), hashToken(session)]);
  const now = Date.now();
  const invite = await db.prepare("select 1 from member_invites where token_hash = ?").bind(tokenHash).first();
  if (invite) {
    const results = await db.batch([
      db.prepare(`update member_invites set redeemed_by = ? where token_hash = ? and redeemed_by is null and expires > ?
        and not exists (select 1 from member_sessions where token_hash = ?)
        and exists (select 1 from team_members where id = member_invites.member_id and coalesce(removal_until,0) <= ?
          and (state = 'invited' and member_invites.kind = 'teammate' or state = 'active' and member_invites.kind = 'device'))`)
        .bind(sessionHash, tokenHash, now, sessionHash, now),
      db.prepare(`update team_members set state = 'active' where state = 'invited' and id in
        (select member_id from member_invites where token_hash = ? and redeemed_by = ?)`).bind(tokenHash, sessionHash),
      db.prepare(`insert into member_sessions (token_hash,member_id) select ?,i.member_id from member_invites i
        join team_members m on m.id = i.member_id where i.token_hash = ? and i.redeemed_by = ?
        and m.state = 'active' and coalesce(m.removal_until,0) <= ?
        on conflict(token_hash) do update set member_id = excluded.member_id where member_sessions.member_id = excluded.member_id
        returning member_id`).bind(sessionHash, tokenHash, sessionHash, now),
      db.prepare(`insert into people(team,key,name) select m.team,m.name_key,m.name from team_members m
        join member_sessions s on s.member_id = m.id where s.token_hash = ? on conflict do nothing`).bind(sessionHash),
    ]);
    return results[2].results.length ? sessionResponse("active", session, pages) : error("This invite has expired or was already used. Request access or ask your team for a new link.", 404);
  }
  const claimed = await claimTeamInvite(db, token, session);
  return claimed ? sessionResponse("active", session, pages, claimed.message)
    : error("This link is no longer available. You can request access below.", 404);
}

async function removal(db: D1Database, actor: Actor, input: Record<string, unknown>) {
  const target = str(input.memberId);
  const now = Date.now();
  if (target === actor.id) return error("Ask another teammate to review your access.");
  const actorStillActive = "exists (select 1 from team_members actor where actor.id = ? and actor.state = 'active' and coalesce(actor.removal_until,0) <= ?)";
  const changed = input.action === "propose-removal"
    ? await db.prepare(`update team_members set removal_by = ?,removal_until = ? where id = ? and team = ?
      and state = 'active' and coalesce(removal_until,0) <= ? and ${actorStillActive} returning id`)
      .bind(actor.id, now + week, target, actor.team, now, actor.id, now).first()
    : await db.prepare(`update team_members set removal_by = null,removal_until = null,state = ?
      where id = ? and team = ? and state = 'active' and removal_until > ? and removal_by != ? and ${actorStillActive} returning id`)
      .bind(input.action === "confirm-removal" ? "removed" : "active", target, actor.team, now, actor.id, actor.id, now).first();
  return changed ? json({ ok: true }) : error("The removal is no longer pending or needs a different teammate.", 409);
}

export async function teamAccessApi(request: Request, db: D1Database, access: BrowserAccess, pages: boolean) {
  const mode = new URL(request.url).searchParams.get("view");
  if (request.method === "GET") {
    if (mode === "status") return json({ state: access.state });
    if (mode === "teams") {
      const { results } = await db.prepare("select name,number from workshop_teams where claimed_at is not null").all<{ name: string; number: string }>();
      const distinct = new Map([...teams, ...results].map(team => [team.number, { number: team.number, name: team.name }]));
      return json({ teams: [...distinct.values()].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return access.state === "active" && access.teamNumber
      ? json(await roster(db, access.teamNumber, access.current?.id ?? null)) : error("Open your team board first.", 403);
  }
  if (request.method !== "POST") return error("Method not supported.", 405);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return error("Use JSON.", 415);
  const raw = await request.text();
  if (raw.length > 4096) return error("This request is too long.", 413);
  let input: Record<string, unknown>;
  try { input = JSON.parse(raw); } catch { return error("Invalid request."); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return error("Invalid request.");
  if (input.action === "request-access" || input.action === "redeem") {
    const session = pages ? request.headers.get(CLAIM_HEADER) ?? "" : newBoardToken();
    if (!validBoardToken(session)) return error("Could not remember this browser.");
    return input.action === "redeem" ? redeem(db, session, str(input.token), pages) : requestAccess(db, session, input, pages);
  }
  if (access.state !== "active" || !access.current) return error("Set your display name on your own device first.", 403);
  switch (input.action) {
    case "approve":
    case "decline":
      return decideRequest(db, access.current, input);
    case "add-device":
    case "invite-device":
    case "invite-teammate":
      return issueMemberInvite(db, access.current, input);
    case "propose-removal":
    case "confirm-removal":
    case "restore-member":
      return removal(db, access.current, input);
    default:
      return error("Unknown team action.");
  }
}

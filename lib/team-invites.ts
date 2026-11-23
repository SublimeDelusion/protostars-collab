import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { teamInvites, teamLinks, teamSessions, teamShareSettings, workshopTeams } from "../db/schema";
import { DEFAULT_TEAM, teamForInvite, teams } from "./teams";

export function validBoardToken(token: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

export function newBoardToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}

async function hashToken(token: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function registeredTeam(db: ReturnType<typeof drizzle>, number: string) {
  const configured = teams.find(team => team.number === number);
  if (configured) return configured;
  const [team] = await db.select({ number: workshopTeams.number, name: workshopTeams.name }).from(workshopTeams)
    .where(and(eq(workshopTeams.number, number), sql`${workshopTeams.claimedAt} is not null`)).limit(1);
  return team && { ...team, logo: "" };
}

export async function findBoardAccess(binding: D1Database, bindings: Record<string, unknown>, token: string) {
  if (!validBoardToken(token)) return undefined;
  const db = drizzle(binding);
  const hash = await hashToken(token);
  const [session] = await db.select().from(teamSessions).where(eq(teamSessions.tokenHash, hash)).limit(1);
  if (session) {
    const team = await registeredTeam(db, session.team);
    return team && { team, kind: "session" as const };
  }
  const [link] = await db.select().from(teamLinks).where(eq(teamLinks.tokenHash, hash)).limit(1);
  if (link) {
    const team = await registeredTeam(db, link.team);
    return team && { team, kind: "magic" as const };
  }
  const configured = teamForInvite(bindings, token);
  const [legacy] = configured ? [] : await db.select({ number: workshopTeams.number, name: workshopTeams.name }).from(workshopTeams)
    .where(eq(workshopTeams.accessHash, hash)).limit(1);
  const team = configured ?? (legacy && { ...legacy, logo: "" });
  if (!team) return undefined;
  const [settings] = await db.select().from(teamShareSettings).where(eq(teamShareSettings.team, team.number)).limit(1);
  if (settings?.legacySessionHash) return undefined;
  return { team, kind: settings ? "legacy-final" as const : "legacy" as const };
}

export async function resumeBoardSession(binding: D1Database, invite: string, session: string) {
  if (!validBoardToken(invite) || !validBoardToken(session) || session === invite) return undefined;
  const db = drizzle(binding);
  const [row] = await db.select().from(teamSessions)
    .where(and(eq(teamSessions.tokenHash, await hashToken(session)), eq(teamSessions.inviteHash, await hashToken(invite)))).limit(1);
  return row && await registeredTeam(db, row.team);
}

export async function startBoardSession(binding: D1Database, team: string, kind: "magic" | "legacy" | "legacy-final", invite: string, session: string) {
  if (!validBoardToken(session) || session === invite) return false;
  const db = drizzle(binding);
  const [hash, inviteHash] = await Promise.all([hashToken(session), hashToken(invite)]);
  if (kind === "magic") {
    await db.batch([
      db.insert(teamSessions).select(sql`select ${hash}, ${team}, ${inviteHash}
        where exists (select 1 from team_links where token_hash = ${inviteHash} and team = ${team})
        on conflict do nothing`),
      db.delete(teamLinks).where(and(eq(teamLinks.tokenHash, inviteHash), sql`exists (
        select 1 from team_sessions where token_hash = ${hash} and team = ${team} and invite_hash = ${inviteHash})`)),
    ]);
  } else {
    await db.batch([
      db.update(teamShareSettings).set({ legacySessionHash: hash }).where(and(eq(teamShareSettings.team, team), isNull(teamShareSettings.legacySessionHash),
        sql`not exists (select 1 from team_sessions where token_hash = ${hash})`)),
      db.insert(teamSessions).select(sql`select ${hash}, ${team}, ${inviteHash}
        where not exists (select 1 from team_share_settings where team = ${team} and legacy_session_hash is not ${hash})
        on conflict do nothing`),
    ]);
  }
  return Boolean(await resumeBoardSession(binding, invite, session));
}

export async function issueMagicLink(binding: D1Database, team: string) {
  const db = drizzle(binding);
  const token = newBoardToken();
  await db.batch([
    db.insert(teamShareSettings).values({ team }).onConflictDoNothing(),
    db.insert(teamLinks).values({ team, tokenHash: await hashToken(token) }),
  ]);
  return token;
}

async function saveOnboardingInvite(db: ReturnType<typeof drizzle>, team: string, message: string) {
  const token = newBoardToken();
  const [saved] = await db.insert(teamInvites).select(sql`select ${await hashToken(token)}, ${team}, ${message}, ${new Date().toISOString()}
    where exists (select 1 from workshop_teams where number = ${team} and claimed_at is null)`).returning();
  return saved ? token : undefined;
}

export async function issueTeamInvite(binding: D1Database, number: string, name: string, message: string, invitedBy: string) {
  if (teams.some(team => team.number === number)) return undefined;
  const db = drizzle(binding);
  const owner = invitedBy === DEFAULT_TEAM ? undefined : eq(workshopTeams.invitedBy, invitedBy);
  const [row] = await db.insert(workshopTeams).values({ number, name, invitedBy })
    .onConflictDoUpdate({ target: workshopTeams.number, set: { name }, setWhere: and(isNull(workshopTeams.claimedAt), eq(workshopTeams.name, name), owner) }).returning();
  return row && saveOnboardingInvite(db, number, message);
}

export async function replaceTeamInvite(binding: D1Database, number: string) {
  const db = drizzle(binding);
  const [previous] = await db.select({ message: teamInvites.message }).from(teamInvites)
    .where(eq(teamInvites.team, number)).orderBy(desc(teamInvites.issuedAt)).limit(1);
  return previous && saveOnboardingInvite(db, number, previous.message);
}

export async function claimTeamInvite(binding: D1Database, token: string, access: string) {
  if (!validBoardToken(token) || !validBoardToken(access) || access === token) return undefined;
  const db = drizzle(binding);
  const [invite] = await db.select({ team: teamInvites.team, message: teamInvites.message }).from(teamInvites)
    .where(eq(teamInvites.tokenHash, await hashToken(token))).limit(1);
  if (!invite) return undefined;
  const hash = await hashToken(access);
  const [[claimed]] = await db.batch([
    db.update(workshopTeams).set({ accessHash: hash, claimedAt: new Date().toISOString() })
      .where(and(eq(workshopTeams.number, invite.team), or(isNull(workshopTeams.claimedAt), eq(workshopTeams.accessHash, hash)))).returning({ number: workshopTeams.number }),
    db.insert(teamSessions).select(sql`select ${hash}, ${invite.team}, null
      where exists (select 1 from workshop_teams where number = ${invite.team} and access_hash = ${hash})
      on conflict do nothing`),
  ]);
  return claimed ? { message: invite.message } : undefined;
}

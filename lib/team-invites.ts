import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { teamInvites, teamSessions, workshopTeams } from "../db/schema";
import { DEFAULT_TEAM, teams } from "./teams";

export function validBoardToken(token: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

export function newBoardToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}

export async function hashToken(token: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function registeredTeam(db: ReturnType<typeof drizzle>, number: string) {
  const configured = teams.find(team => team.number === number);
  if (configured) return configured;
  const [team] = await db.select({ number: workshopTeams.number, name: workshopTeams.name }).from(workshopTeams)
    .where(and(eq(workshopTeams.number, number), sql`${workshopTeams.claimedAt} is not null`)).limit(1);
  return team && { ...team, logo: "" };
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

import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { teamInvites, workshopTeams } from "../db/schema";
import { teams } from "./teams";

export function validBoardToken(token: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

async function hashToken(token: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function findJoinedTeam(binding: D1Database, token: string) {
  if (!validBoardToken(token)) return undefined;
  const db = drizzle(binding);
  const [team] = await db.select({ number: workshopTeams.number, name: workshopTeams.name }).from(workshopTeams)
    .where(eq(workshopTeams.accessHash, await hashToken(token))).limit(1);
  return team && { ...team, logo: "" };
}

export async function issueTeamInvite(binding: D1Database, number: string, name: string, message: string) {
  if (teams.some(team => team.number === number)) return undefined;
  const db = drizzle(binding);
  const [row] = await db.insert(workshopTeams).values({ number, name })
    .onConflictDoUpdate({ target: workshopTeams.number, set: { name }, setWhere: and(isNull(workshopTeams.claimedAt), eq(workshopTeams.name, name)) }).returning();
  if (!row) return undefined;
  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.insert(teamInvites).values({ tokenHash: await hashToken(token), team: number, message, issuedAt: new Date().toISOString() });
  return token;
}

export async function claimTeamInvite(binding: D1Database, token: string, access: string) {
  if (!validBoardToken(token) || !validBoardToken(access) || access === token) return undefined;
  const db = drizzle(binding);
  const [invite] = await db.select({ team: teamInvites.team, message: teamInvites.message }).from(teamInvites)
    .where(eq(teamInvites.tokenHash, await hashToken(token))).limit(1);
  if (!invite) return undefined;
  const hash = await hashToken(access);
  const [claimed] = await db.update(workshopTeams).set({ accessHash: hash, claimedAt: new Date().toISOString() })
    .where(and(eq(workshopTeams.number, invite.team), isNull(workshopTeams.claimedAt))).returning({ number: workshopTeams.number });
  if (!claimed) {
    // A retry from the same browser can finish a claim after a dropped response.
    const [existing] = await db.select({ number: workshopTeams.number }).from(workshopTeams)
      .where(and(eq(workshopTeams.number, invite.team), eq(workshopTeams.accessHash, hash))).limit(1);
    if (!existing) return undefined;
  }
  return { message: invite.message };
}

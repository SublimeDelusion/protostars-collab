import config from "../config/teams.json";
import type { Entry, TeamInfo } from "./board";

export const DEFAULT_TEAM = "17097";
export const TEAM_HEADER = "X-Board-Team-Internal";
export const teams = config.teams;
if (new Set(teams.map(team => team.number)).size !== teams.length ||
    new Set(teams.map(team => team.inviteSecret)).size !== teams.length ||
    teams.some(team => !/^\d{1,12}$/.test(team.number) || !team.name.trim() ||
      !/^[A-Z][A-Z0-9_]+$/.test(team.inviteSecret) ||
      !team.logo.startsWith("/teams/" + team.number + "/") ||
      !/^[-a-zA-Z0-9_]+\.(jpg|jpeg|png|svg|webp)$/.test(team.logo.split("/").at(-1) ?? "") ||
      team.logo.split("/").length !== 4)) {
  throw new Error("Invalid or duplicate team configuration");
}
const dataFiles = import.meta.glob("../config/teams/*/data.json", { eager: true, import: "default" }) as Record<string, Entry[]>;

export const TEAM_NAME_HEADER = "X-Board-Team-Name-Internal";

export function teamFor(request: Request): TeamInfo {
  const number = request.headers.get(TEAM_HEADER);
  const name = request.headers.get(TEAM_NAME_HEADER);
  const team = teams.find(item => item.number === number) ?? (number && name ? { number, name: decodeURIComponent(name), logo: "" } : undefined);
  if (!team) throw new Error("Missing validated board team");
  return team;
}

export function teamSeed(number: string) {
  const entries = dataFiles[`../config/teams/${number}/data.json`] ?? [];
  if (number === DEFAULT_TEAM) {
    return entries.map(entry => ({ ...entry, source: "2026 Butte Qualifier" }));
  }
  return entries.map(entry => ({ ...entry, id: number + ":" + entry.id, parent: entry.parent ? number + ":" + entry.parent : null }));
}

export function teamInfo(team: TeamInfo): TeamInfo {
  return { number: team.number, name: team.name, logo: team.logo };
}

export function teamForInvite(bindings: Record<string, unknown>, token: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return undefined;
  const matches = teams.filter(team => bindings[team.inviteSecret] === token);
  return matches.length === 1 ? matches[0] : undefined;
}

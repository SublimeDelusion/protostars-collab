import { severities } from "../lib/board";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const contributions = sqliteTable("contributions", {
  team: text().notNull().default("17097"),
  id: text().primaryKey(),
  kind: text().notNull(),
  parent: text(),
  title: text().notNull(),
  body: text().notNull(),
  author: text().notNull(),
  created: text().notNull(),
  severity: text({ enum: severities }),
  outcomeFor: text("outcome_for"),
  starVoter: text("star_voter"),
  ownerTeam: text("owner_team"),
}, table => [
  uniqueIndex("one_active_outcome").on(table.team, table.outcomeFor),
  uniqueIndex("one_star_per_idea_and_voter").on(table.team, table.parent, table.starVoter),
]);

export const todos = sqliteTable("todos", {
  team: text().notNull().default("17097"),
  assignee: text(),
  ideaId: text("idea_id").primaryKey(),
  done: integer({ mode: "boolean" }).notNull().default(false),
  rank: integer(),
  inProgress: integer("in_progress", { mode: "boolean" }).notNull().default(false),
  created: text().notNull(),
});

export const people = sqliteTable("people", {
  team: text().notNull().default("17097"),
  key: text().notNull(),
  name: text().notNull(),
  renamedTo: text("renamed_to"),
}, table => [primaryKey({ columns: [table.team, table.key] })]);

export const workshopTeams = sqliteTable("workshop_teams", {
  number: text().primaryKey(),
  name: text().notNull(),
  accessHash: text("access_hash").unique(),
  claimedAt: text("claimed_at"),
  invitedBy: text("invited_by"),
});

export const teamInvites = sqliteTable("team_invites", {
  tokenHash: text("token_hash").primaryKey(),
  team: text().notNull().references(() => workshopTeams.number),
  message: text().notNull(),
  issuedAt: text("issued_at").notNull(),
});

export const teamLinks = sqliteTable("team_links", {
  tokenHash: text("token_hash").primaryKey(),
  team: text().notNull(),
});

export const teamSessions = sqliteTable("team_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  team: text().notNull(),
  inviteHash: text("invite_hash"),
});

export const teamShareSettings = sqliteTable("team_share_settings", {
  team: text().primaryKey(),
  legacySessionHash: text("legacy_session_hash"),
});

CREATE TABLE `team_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`team` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`team` text NOT NULL,
	`invite_hash` text
);
--> statement-breakpoint
CREATE TABLE `team_share_settings` (
	`team` text PRIMARY KEY NOT NULL,
	`legacy_session_hash` text
);
--> statement-breakpoint
ALTER TABLE `contributions` ADD `owner_team` text;--> statement-breakpoint
ALTER TABLE `workshop_teams` ADD `invited_by` text;
--> statement-breakpoint
WITH RECURSIVE shared(id) AS (
  SELECT id FROM contributions WHERE kind = 'enhancement'
  UNION
  SELECT c.id FROM contributions c JOIN shared p ON c.parent = p.id
)
UPDATE contributions SET owner_team = team, team = '@enhancements',
  star_voter = CASE WHEN star_voter IS NOT NULL THEN team || ':' || star_voter END
WHERE id IN (SELECT id FROM shared);
--> statement-breakpoint
INSERT INTO contributions (team,id,kind,title,body,author,created,owner_team)
VALUES ('@enhancements','workshop-independent-database-hosting','enhancement',
  'Find a team-owned home for the Workshop database',
  'FTC Workshop currently uses Cloudflare D1 through Coach Jason’s ChatGPT Sites subscription. That setup is fine for now. Explore a team-owned place to host the database so the Workshop can keep running independently of that subscription. Keep team data private and make backups and recovery manageable without asking team members to hold private keys.',
  'Jason',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'17097');

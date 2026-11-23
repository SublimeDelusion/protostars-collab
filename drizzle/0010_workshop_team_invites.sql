CREATE TABLE `team_invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`team` text NOT NULL,
	`message` text NOT NULL,
	`issued_at` text NOT NULL,
	FOREIGN KEY (`team`) REFERENCES `workshop_teams`(`number`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workshop_teams` (
	`number` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`access_hash` text,
	`claimed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workshop_teams_access_hash_unique` ON `workshop_teams` (`access_hash`);
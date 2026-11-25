CREATE TABLE `access_requests` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`team` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`email` text,
	`existing` integer NOT NULL,
	`state` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_requests_id_unique` ON `access_requests` (`id`);--> statement-breakpoint
CREATE TABLE `member_invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expires` integer NOT NULL,
	`kind` text NOT NULL,
	`redeemed_by` text,
	FOREIGN KEY (`member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `member_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team` text NOT NULL,
	`name_key` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`removal_by` text,
	`removal_until` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_member_name` ON `team_members` (`team`,`name_key`);
--> statement-breakpoint
INSERT INTO team_members (id,team,name_key,name,state)
SELECT lower(hex(randomblob(16))), team, key, name, 'active' FROM people
WHERE renamed_to IS NULL AND key != 'competition debrief';

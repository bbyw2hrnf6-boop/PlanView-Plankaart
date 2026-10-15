CREATE TABLE `ai_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`user_id` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`requests` integer NOT NULL,
	`busy_until` integer NOT NULL
);

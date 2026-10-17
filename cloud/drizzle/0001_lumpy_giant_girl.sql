CREATE TABLE `source_credentials` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `provider`)
);

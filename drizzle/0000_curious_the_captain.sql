CREATE TABLE `mail_history` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`shop_id` text NOT NULL,
	`shop_name` text NOT NULL,
	`buyer_mail` text DEFAULT '' NOT NULL,
	`buyer_translation` text DEFAULT '' NOT NULL,
	`tracking_number` text DEFAULT '' NOT NULL,
	`logistics_status` text DEFAULT '' NOT NULL,
	`logistics_summary` text DEFAULT '' NOT NULL,
	`logistics_recommendation` text DEFAULT '' NOT NULL,
	`custom_instruction` text DEFAULT '' NOT NULL,
	`action` text DEFAULT 'none' NOT NULL,
	`chinese_reply` text NOT NULL,
	`localized_reply` text NOT NULL,
	`target_language` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_history_created_at_idx` ON `mail_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `mail_history_shop_created_at_idx` ON `mail_history` (`shop_id`,`created_at`);
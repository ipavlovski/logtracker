CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_spans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device` text NOT NULL,
	`kind` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_spans_end_idx` ON `activity_spans` (`end_at`);--> statement-breakpoint
CREATE TABLE `ai_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`model` text,
	`title` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`turns` integer NOT NULL,
	`prompt_times` text NOT NULL,
	`source_stamp` text,
	`imported_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_chats_started_idx` ON `ai_chats` (`started_at`);--> statement-breakpoint
CREATE TABLE `checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`checklist_id` text NOT NULL,
	`label` text NOT NULL,
	`target` integer DEFAULT 1 NOT NULL,
	`source` text,
	`position` real NOT NULL,
	`added_date` text NOT NULL,
	`removed_date` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`checklist_id`) REFERENCES `checklists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checklist_items_list_idx` ON `checklist_items` (`checklist_id`,`position`);--> statement-breakpoint
CREATE TABLE `checklist_marks` (
	`item_id` text NOT NULL,
	`date` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `date`),
	FOREIGN KEY (`item_id`) REFERENCES `checklist_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checklist_marks_date_idx` ON `checklist_marks` (`date`);--> statement-breakpoint
CREATE TABLE `checklists` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`position` real NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`weekdays` integer DEFAULT 127 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`recurrence` text DEFAULT 'none' NOT NULL,
	`until` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_start_idx` ON `events` (`start_at`);--> statement-breakpoint
CREATE TABLE `gps_days` (
	`date` text PRIMARY KEY NOT NULL,
	`source_stamp` text NOT NULL,
	`day_start` integer NOT NULL,
	`homebase_id` text,
	`homebase_override` integer DEFAULT false NOT NULL,
	`point_count` integer NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gps_places` (
	`id` text PRIMARY KEY NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gps_segments` (
	`date` text NOT NULL,
	`idx` integer NOT NULL,
	`kind` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`place_id` text,
	`from_place_id` text,
	`to_place_id` text,
	`distance_m` integer NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`date`, `idx`),
	FOREIGN KEY (`date`) REFERENCES `gps_days`(`date`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gps_trips` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`date`) REFERENCES `gps_days`(`date`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gps_trips_date_idx` ON `gps_trips` (`date`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`counterpart` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`at` integer NOT NULL,
	`duration_s` integer,
	`import_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_at_idx` ON `messages` (`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_import_idx` ON `messages` (`import_hash`);--> statement-breakpoint
CREATE TABLE `progress_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `progress_notes_date_idx` ON `progress_notes` (`date`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`color` text,
	`archived` integer DEFAULT false NOT NULL,
	`position` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scheduled_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`payee` text NOT NULL,
	`amount` integer NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`account_id` text,
	`cadence` text NOT NULL,
	`next_due` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`done_at` integer,
	`indent` integer DEFAULT 0 NOT NULL,
	`position` real NOT NULL,
	`due` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_done_idx` ON `tasks` (`done_at`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`payee` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`import_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_import_idx` ON `transactions` (`import_hash`);--> statement-breakpoint
CREATE TABLE `web_visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile` text NOT NULL,
	`chrome_visit_id` integer NOT NULL,
	`at` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_visits_source_idx` ON `web_visits` (`profile`,`chrome_visit_id`);--> statement-breakpoint
CREATE INDEX `web_visits_at_idx` ON `web_visits` (`at`);--> statement-breakpoint
CREATE TABLE `yt_watches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`channel` text,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yt_watches_video_at_idx` ON `yt_watches` (`video_id`,`at`);--> statement-breakpoint
CREATE INDEX `yt_watches_at_idx` ON `yt_watches` (`at`);
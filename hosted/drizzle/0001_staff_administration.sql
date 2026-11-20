ALTER TABLE users ADD COLUMN display_name TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN subject_title TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN assigned_paper TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN can_upload INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

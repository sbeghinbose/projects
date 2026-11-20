ALTER TABLE users ADD COLUMN email TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN student_number TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN class_name TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN created_at TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN can_report INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE password_reset_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER NOT NULL,target_id INTEGER NOT NULL,changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE INDEX scores_attempted_at ON scores(attempted_at);

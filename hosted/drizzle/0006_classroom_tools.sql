ALTER TABLE exams ADD COLUMN blueprint_json TEXT;
--> statement-breakpoint
ALTER TABLE learning_attempts ADD COLUMN assignment_id INTEGER;
--> statement-breakpoint
CREATE TABLE revision_assignments(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER NOT NULL,group_id INTEGER NOT NULL,title TEXT NOT NULL,paper TEXT NOT NULL,topic TEXT NOT NULL,question_count INTEGER NOT NULL,due_at TEXT NOT NULL,instructions TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE UNIQUE INDEX assignment_student_attempt ON learning_attempts(assignment_id,student_id) WHERE assignment_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE mistake_notebook(student_id INTEGER NOT NULL,question_id INTEGER NOT NULL,snapshot_json TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(student_id,question_id));
--> statement-breakpoint
CREATE TABLE question_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,question_id INTEGER NOT NULL,actor_id INTEGER NOT NULL,snapshot_json TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE INDEX versions_question ON question_versions(question_id,id);
--> statement-breakpoint
CREATE TABLE user_mfa(user_id INTEGER PRIMARY KEY,secret TEXT,enabled INTEGER NOT NULL DEFAULT 0,pending_secret TEXT,pending_expires INTEGER,last_counter INTEGER NOT NULL DEFAULT -1,recovery_hashes TEXT NOT NULL DEFAULT '[]',failures INTEGER NOT NULL DEFAULT 0,blocked_until INTEGER NOT NULL DEFAULT 0);

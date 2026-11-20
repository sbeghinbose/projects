ALTER TABLE questions ADD COLUMN explanation TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE questions ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'unrated';
--> statement-breakpoint
ALTER TABLE questions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE class_groups (id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER NOT NULL,name TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE group_members (group_id INTEGER NOT NULL,student_id INTEGER NOT NULL,PRIMARY KEY(group_id,student_id));
--> statement-breakpoint
CREATE TABLE exams (id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER NOT NULL,title TEXT NOT NULL,paper TEXT NOT NULL,topic TEXT NOT NULL,group_id INTEGER,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,duration_minutes INTEGER NOT NULL,question_count INTEGER NOT NULL,difficulty TEXT NOT NULL DEFAULT 'all',release_policy TEXT NOT NULL DEFAULT 'immediate',results_released INTEGER NOT NULL DEFAULT 0,instructions TEXT NOT NULL DEFAULT '',cancelled INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE learning_attempts (id TEXT PRIMARY KEY,student_id INTEGER NOT NULL,exam_id INTEGER,paper TEXT NOT NULL,topic TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',started_at TEXT NOT NULL,deadline TEXT,snapshot_json TEXT NOT NULL,answers_json TEXT NOT NULL DEFAULT '{}',submitted_at TEXT,UNIQUE(exam_id,student_id));
--> statement-breakpoint
ALTER TABLE scores ADD COLUMN attempt_id TEXT;
--> statement-breakpoint
ALTER TABLE scores ADD COLUMN exam_id INTEGER;
--> statement-breakpoint
ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'exam';
--> statement-breakpoint
CREATE UNIQUE INDEX score_learning_attempt ON scores(attempt_id);
--> statement-breakpoint
CREATE INDEX learning_student ON learning_attempts(student_id,status);
--> statement-breakpoint
CREATE TABLE announcements (id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER NOT NULL,group_id INTEGER,title TEXT NOT NULL,message TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);

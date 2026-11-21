ALTER TABLE questions ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'approved';
--> statement-breakpoint
ALTER TABLE exams ADD COLUMN access_code TEXT;
--> statement-breakpoint
ALTER TABLE exams ADD COLUMN shuffle_options INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE question_submissions(id INTEGER PRIMARY KEY AUTOINCREMENT,question_id INTEGER,author_id INTEGER NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE question_flags(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,question_id INTEGER NOT NULL,question_text TEXT NOT NULL,message TEXT NOT NULL,status TEXT DEFAULT 'open',response TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE resources(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER NOT NULL,paper TEXT NOT NULL,topic TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,url TEXT,archived INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE accommodations(exam_id INTEGER NOT NULL,student_id INTEGER NOT NULL,extra_minutes INTEGER NOT NULL,PRIMARY KEY(exam_id,student_id));
--> statement-breakpoint
CREATE TABLE recovery_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,message TEXT NOT NULL,status TEXT DEFAULT 'open',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE INDEX flags_question ON question_flags(question_id,status);

--> statement-breakpoint
ALTER TABLE questions ADD COLUMN diagram_data_uri TEXT;
--> statement-breakpoint
ALTER TABLE questions ADD COLUMN diagram_alt TEXT;

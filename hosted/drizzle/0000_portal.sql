CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE questions (id INTEGER PRIMARY KEY AUTOINCREMENT,question TEXT NOT NULL,option_a TEXT NOT NULL,option_b TEXT NOT NULL,option_c TEXT NOT NULL,option_d TEXT NOT NULL,correct_option TEXT NOT NULL,paper TEXT,topic TEXT,source_number INTEGER,source_key TEXT UNIQUE);
--> statement-breakpoint
CREATE TABLE scores (id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,score INTEGER NOT NULL,total INTEGER NOT NULL,attempted_at TEXT DEFAULT CURRENT_TIMESTAMP,topic TEXT,review_json TEXT);
--> statement-breakpoint
CREATE TABLE sessions (token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires INTEGER NOT NULL,quiz_json TEXT);
--> statement-breakpoint
CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX student_scores ON scores(student_id,id);

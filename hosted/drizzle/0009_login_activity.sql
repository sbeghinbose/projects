CREATE TABLE login_activity(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,username TEXT NOT NULL,display_name TEXT NOT NULL,role TEXT NOT NULL,login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,logout_at TEXT,expires_at TEXT NOT NULL,session_token TEXT NOT NULL UNIQUE);
--> statement-breakpoint
CREATE INDEX login_activity_time ON login_activity(login_at,id);
--> statement-breakpoint
CREATE INDEX login_activity_role_time ON login_activity(role,login_at,id);
--> statement-breakpoint
INSERT OR IGNORE INTO metadata(key,value) VALUES ('login-activity-started-at',CURRENT_TIMESTAMP);

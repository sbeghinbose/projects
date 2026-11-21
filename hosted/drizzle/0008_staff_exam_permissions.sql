ALTER TABLE exams ADD COLUMN grace_minutes INTEGER NOT NULL DEFAULT 2;
--> statement-breakpoint
CREATE TABLE exam_students(exam_id INTEGER NOT NULL,student_id INTEGER NOT NULL,granted_by INTEGER NOT NULL,granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,revoked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(exam_id,student_id));
--> statement-breakpoint
CREATE INDEX student_exam_permissions ON exam_students(student_id,revoked,exam_id);
--> statement-breakpoint
INSERT OR IGNORE INTO exam_students(exam_id,student_id,granted_by) SELECT e.id,m.student_id,e.owner_id FROM exams e JOIN group_members m ON m.group_id=e.group_id WHERE e.cancelled=0;

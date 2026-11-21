# Hosted Worker

This is the deployed application, backed by Cloudflare D1; it has additional features beyond the original Express app. Configure `DB` as the D1 binding and apply `drizzle/` schema migrations. Build with `npm ci` then `npm run build`.

`INITIAL_DATA` is an optional, secret, one-time migration JSON value containing existing users and scores. Never put its contents in source control. Startup imports records idempotently and marks the initial migration complete. All subsequent account and attempt data lives in D1.

Sites handles public HTTPS hosting. Usernames and passwords retain the app login experience; only students can self-register. Existing bcrypt hashes upgrade to PBKDF2 on successful login. Sessions are stored in D1 as hashed random tokens.

## Account administration and reports

Administrators can assign/reset student and staff passwords (all previous sessions are revoked), change their own password, and download registration reports as PDF, DOCX, or XLSX. Passwords and hashes never appear in exports.

Staff with report permission can select an exam date, timezone, subject, and pass benchmark, preview student marks and analysis, and download a PDF. Assigned staff are limited to their subject. Original staff with unrestricted topic access retain that access until an administrator narrows the assignment.

Exam dates use submission timestamps converted from the selected local day to UTC boundaries. Repeat attempts count separately; unique students are shown separately. Old registration dates that were never recorded display as Not recorded. New student registration supports full name, email, student/admission number, and class/section.

Exports are generated on the server using pdf-lib, an embedded Noto Sans font, and OOXML ZIP packages. Noto Sans licensing is in fonts/LICENSE.txt.

## Learning and teaching features

The public Cloudflare address serves the same app with a student learning centre and teaching workspace. New additive schema migrations preserve existing records.

- Scheduled, timed, class-targeted exams with server-enforced deadlines and one attempt per student.
- Practice with immediate feedback, authored explanations, and retry of previously wrong questions.
- Topic coverage, latest-question accuracy, average marks and best marks; withheld exam results are excluded.
- Teacher-owned class groups and targeted announcements.
- Word/Excel imports with templates, client-side preview and validation (DOCX/XLSX, not scanned images).
- Question editing, difficulty ratings and reversible archiving. Existing attempts use immutable snapshots.
- Server draft saves and per-attempt local recovery. Offline answers sync only before the exam deadline; expired attempts use answers already saved on the server.
- Automatic submission on expiry when the student resumes, submits, or the teacher loads attendance. The online timer also submits at expiry.
- Manual teacher release or immediate release of marks and answer reviews.
- Attendance, submitted/missed status, marks and PDF/Word/Excel attendance exports for permitted teachers.

All 500 original questions include answer explanations. Five original diagrams and three pseudocode blocks have been restored from the source Word document, with accessible text descriptions. Original question difficulties remain Unrated until staff assess them. Balanced selection uses the available rated levels and fills remaining places from the topic. Practice is excluded from daily exam reports.

## Revision, support and safeguards

- Personal revision priorities and spaced reviews: incorrect answers after two days, correct answers after seven days, based only on released results. Revision is shown after login; no email or push reminders are configured.
- Exam codes checked on first start, shuffled option snapshots with remapped answer keys, and individually assigned extra minutes before starting. Extra time never exceeds the exam submission-window end.
- Staff additions and edits require administrator approval. Approved edits replace the live question only after approval; immutable attempts retain their original content.
- Student question reports and staff replies; question accuracy analysis for up to 5,000 recent scored attempts, including practice and unanswered responses.
- Ten starter topic resources with worked examples, plus staff-created notes and HTTPS links.
- Large text, high contrast, reduced motion, keyboard controls and a skip link. Preferences are saved on the device.
- Administrator-reviewed recovery requests. School identity verification is required before a reset; no automatic email delivery is configured.
- Administrator-only full data backup, with current-password verification. The browser encrypts downloads using AES-256-GCM with a PBKDF2-SHA256-derived key (250,000 iterations, random salt and IV). Backup passphrases are never sent to the server. Backups contain personal data and password hashes; keep them private. Sessions are excluded.
- Restore accepts this schema's backups, validates fields, previews counts, requires typed confirmation and current admin password, then replaces data in one D1 transaction. All sessions are revoked; the current administrator password is retained. Browser restore is limited to 20,000 rows and a 10 MB request. No automatic backup schedule is configured.

Public address: https://beghin-mcq.beghin.workers.dev/

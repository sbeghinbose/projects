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

## Classroom tools

- Class performance groups the latest answer per student/question by topic, across up to 5,000 recent scored attempts. Teacher views include submitted results awaiting release and practice. Only owned classes and permitted subjects are accessible.
- Pre-exam readiness checks class eligibility, the exam code, the time window, question availability, connectivity and local answer recovery without creating an attempt or starting its timer. It cannot guarantee future network availability.
- Teachers assign topic practice to a class with a due date, question count and instructions. One durable attempt per student/assignment supports resuming and on-time/late completion reporting.
- Students save private question notes from practice or released exam reviews. Unreleased or active exam answers cannot be copied into the notebook.
- Exams support up to ten distinct topic sections and 100 questions total, with exact per-section counts and difficulty filters. Marks remain two per question; topic progress includes mixed exams.
- Previous question snapshots, actor names and reasons are recorded on edits, approvals, archiving and restores. Administrator restore creates another history entry and leaves existing attempt snapshots intact.
- Question/import duplicates are checked with normalised exact matching and token similarity (at least five tokens, Jaccard >=0.82). Warnings require deliberate confirmation; similarity is a heuristic rather than proof of duplication.
- Optional administrator TOTP follows RFC 6238 (SHA-1, six digits, 30-second steps), with manual authenticator pairing, one-use hashed recovery codes, replay protection, temporary failure blocking and session revocation on enable/disable. Setup secrets are encrypted in D1 using an AES-GCM wrapping key derived from the existing runtime bootstrap secret. Preserve ADMIN_PASSWORD_HASH in the hosting environment even after changing the administrator login password. The owner must pair their own authenticator; deployment does not activate MFA on any account.
- Backups now include revision assignments, notebook entries and question versions. MFA setup and recovery secrets are excluded and preserved in place during restore; restore rejects backups that remove or rename an MFA-protected administrator. A backup from an older schema may require migration before restore.

Reference: https://www.rfc-editor.org/rfc/rfc6238

## Expanded question bank

Migration 0007 adds 4,000 owner-supplied questions from four DOCX files. Every source contains 1,000 numbered questions with matching answer-key option text. Source document/number keys make the import repeat-safe. Existing questions, accounts, assignments, attempts and results are preserved. Topic headings map to the existing ten subjects, as documented in imported-bank-manifest.json. The live bank now contains 4,500 questions: 2,300 in Paper 1 and 2,200 in Paper 2. The imported records are approved and available for practice/exams, with unrated difficulty and blank explanations because those fields were not supplied.

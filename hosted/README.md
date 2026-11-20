# Hosted Worker

This version uses the same UI and features as the local Express app, backed by Cloudflare D1. Configure `DB` as the D1 binding and apply `drizzle/` schema migrations. Build with `npm ci` then `npm run build`.

`INITIAL_DATA` is an optional, secret, one-time migration JSON value containing existing users and scores. Never put its contents in source control. Startup imports records idempotently and marks the initial migration complete. All subsequent account and attempt data lives in D1.

Sites handles public HTTPS hosting. Usernames and passwords retain the app login experience; only students can self-register. Existing bcrypt hashes upgrade to PBKDF2 on successful login. Sessions are stored in D1 as hashed random tokens.

## Account administration and reports

Administrators can assign/reset student and staff passwords (all previous sessions are revoked), change their own password, and download registration reports as PDF, DOCX, or XLSX. Passwords and hashes never appear in exports.

Staff with report permission can select an exam date, timezone, subject, and pass benchmark, preview student marks and analysis, and download a PDF. Assigned staff are limited to their subject. Original staff with unrestricted topic access retain that access until an administrator narrows the assignment.

Exam dates use submission timestamps converted from the selected local day to UTC boundaries. Repeat attempts count separately; unique students are shown separately. Old registration dates that were never recorded display as Not recorded. New student registration supports full name, email, student/admission number, and class/section.

Exports are generated on the server using pdf-lib, an embedded Noto Sans font, and OOXML ZIP packages. Noto Sans licensing is in fonts/LICENSE.txt.

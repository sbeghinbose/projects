# Coding Lab Learning Portal

Public website: https://beghin-mcq.beghin.workers.dev/

The Cloudflare public host forwards to the existing Sites backend, preserving the same database and accounts. Keep the Sites backend published.

Open this HTTPS link on computers and smartphones. GitHub stores the source; the public app runs on Sites with Cloudflare D1 persistence. Your computer can be switched off.

- 4,500 questions across ten topics: 2,300 for Paper 1 and 2,200 for Paper 2. Practice can select 50 questions per attempt.
- Student-only registration; existing staff accounts are migrated privately.
- Two marks per correct answer, 100 total per 50-question quiz.
- Dashboard history and red incorrect/unanswered answer reviews.

## Source layout

The root contains the original Express/SQLite app. Run `npm ci` and `npm start` to use it locally.

`hosted/` contains the deployed Cloudflare Worker version, public HTML/JS, question bank, and schema migrations. Run `npm ci` and `npm run build` within that folder to build it. It requires a D1 binding named `DB`; production deployment is managed through Sites. Building or pushing to this GitHub repository alone does not redeploy the hosted Site.

User accounts, password hashes, quiz results, sessions, and bootstrap secrets are not stored in this repository. The existing accounts were transferred through a secret hosting environment value.

The Render configuration is an optional paid alternative, not the current hosting service.

`public-host/` contains the Cloudflare Workers Free public address configuration. Deploy with Wrangler after signing in to the owner account.

The deployed version now includes personal and spaced revision, exam codes and shuffled options, staff question approval, question quality analysis, student question reports, topic resources, accessibility options, verified account recovery, and encrypted full data backup/restore. See `hosted/README.md` for behaviour and limits.

Classroom tools add class performance analysis, exam readiness checks, staff-assigned revision, private mistake notebooks, question version history, duplicate checks, multi-topic exams, and optional administrator two-factor authentication.

The public front page uses the owner-provided Coding Lab flyer, its complete campaign text, a responsive navy/gold/turquoise layout, and student/staff login panels. The original flyer is embedded directly, without external image dependencies.

Four owner-supplied Word documents added 4,000 questions with their answer keys. Topic aliases map the source headings to the existing ten subjects; source filenames and question numbers form unique import keys. See `hosted/imported-bank-manifest.json` for per-file counts, source hashes and title mapping. The added questions have unrated difficulty and no authored explanations in the source documents.

Student access is now locked after registration: announcements and original educational quotes are available, while questions open only through explicitly staff-approved exams. Staff select recipients, chapters, counts, time slots, and may revoke permission. Two extra minutes are included in the personal timer and final closing deadline. Independent practice and student learning-resource/notebook tools are disabled under this policy.

Administrators can monitor successful student/staff sign-ins by date, time, account and timezone, including explicit sign-outs and valid/expired/ended session state. Login activity exports are available as PDF, DOCX and XLSX. Recording starts when migration 0009 is deployed; earlier login history is unavailable.

Exam access: Staff exam cards show approved usernames. Exact username search distinguishes similar accounts; returning students refresh permissions immediately. Duplicate scheduling clicks are blocked.

Staff review: Teaching Workspace now lists submitted exams and provides answer-level review with individual mark approval. Manual results remain hidden until the owning staff member or administrator approves. Approvals retain the reviewer and UTC timestamp.

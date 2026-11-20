# Hosted Worker

This version uses the same UI and features as the local Express app, backed by Cloudflare D1. Configure `DB` as the D1 binding and apply `drizzle/` schema migrations. Build with `npm ci` then `npm run build`.

`INITIAL_DATA` is an optional, secret, one-time migration JSON value containing existing users and scores. Never put its contents in source control. Startup imports records idempotently and marks the initial migration complete. All subsequent account and attempt data lives in D1.

Sites handles public HTTPS hosting. Usernames and passwords retain the app login experience; only students can self-register. Existing bcrypt hashes upgrade to PBKDF2 on successful login. Sessions are stored in D1 as hashed random tokens.

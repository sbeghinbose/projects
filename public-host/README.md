# Free Cloudflare public address

This Worker provides a workers.dev URL for the existing MCQ portal without buying a domain. It forwards requests to the existing Sites app, which remains the backend and stores the shared question bank, accounts, sessions, and marks. Do not shut down or unpublish that backend.

The proxy has a fixed upstream, streams downloads, preserves secure session cookies, validates write-request origins, and rewrites same-backend redirects to the public address. It does not copy account data into source control.

Deploy on Cloudflare Workers Free using Wrangler and the owner's Cloudflare account. The final URL is returned after deployment; no URL is reserved by these source files alone.

The Free plan has usage limits. Do not enable a paid subscription for this project without the owner's agreement.

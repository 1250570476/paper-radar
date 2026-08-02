# CatchPapers

A research-monitoring product built around one promise: catch every newly published paper that matters. CatchPapers follows selected journal sources, matches new work to each research profile, and sends personal email digests.

## Current MVP

- Upload a PDF, TXT, or Markdown CV
- Add an editable research-interest description and excluded keywords
- Follow journals from the curated publisher-source catalog
- Read recent articles collected from official publisher pages and feeds
- Rank titles and abstracts locally using transparent keyword scoring
- Explain which research terms produced each match
- Save papers in browser storage
- Keep uploaded CV files and extracted CV text in the user's browser
- Sync derived research interests, selected journals, and saved-paper IDs through Supabase
- Receive deduplicated daily or weekly alerts through Resend
- Pause alerts, unsubscribe from an email, or delete the account and associated data

The paper feed remains usable without an account. The public Supabase browser key belongs in `supabase-config.js`; the `service_role` and Resend keys must exist only as encrypted GitHub Actions secrets.

## Activate accounts and alerts

1. Run `supabase/schema.sql` in **Supabase → SQL Editor**.
2. Add these encrypted repository secrets in **GitHub → Settings → Secrets and variables → Actions**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY`
3. Add these repository variables in the same area:
   - `CATCHPAPERS_FROM_EMAIL` — for example `CatchPapers <papers@updates.catchpapers.app>`
   - `CATCHPAPERS_SITE_URL` — `https://catchpapers.app/`
4. Verify the sending domain in Resend. Never commit either secret key.
5. Run the **Update direct publisher papers** workflow manually for the first end-to-end test.

## Run locally

Because the prototype is a static application, start any local file server from the repository:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

PDF extraction uses the reviewed, repository-pinned Mozilla PDF.js distribution in `vendor/pdfjs`. The 10 MB and 60-page limits protect browser responsiveness.

## Deploy free with GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select the `main` branch and `/(root)`.
4. Save and wait for the Pages URL to appear.

## How matching works

1. Technical terms are extracted from the local CV text and the research-interest description.
2. CatchPapers checks indexed papers from each selected journal.
3. Each title match receives more weight than an abstract match.
4. Excluded terms remove unwanted results.
5. The feed is ranked by the resulting relevance score.

The browser feed uses a richer concept-family matcher, while the alert job uses a conservative phrase and keyword threshold. Both remain transparent and do not require sending a user's profile to an AI provider.

## Data and privacy

CV files and extracted CV text stay in browser storage. Signed-in users sync only their interests, excluded terms, selected journal IDs, saved-paper IDs, and alert settings. Supabase Row-Level Security limits user-facing access to each user's own records. The scheduled server job uses a protected service key to prepare alerts and records delivered paper IDs to prevent duplicates.

## License

MIT

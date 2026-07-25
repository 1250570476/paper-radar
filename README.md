# Paper Radar

A privacy-friendly, no-cost prototype that discovers recently published research and ranks it against a user's CV and stated interests.

## Current MVP

- Upload a PDF, TXT, or Markdown CV
- Add an editable research-interest description and excluded keywords
- Follow curated journals or add custom journal names
- Retrieve recent articles from the free [OpenAlex](https://openalex.org) API
- Rank titles and abstracts locally using transparent keyword scoring
- Explain which research terms produced each match
- Save papers in browser storage
- Keep CV text and preferences in the user's browser

No OpenAI API key, database, user account, or paid service is required.

## Run locally

Because the prototype is a static application, start any local file server from the repository:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

PDF extraction loads Mozilla PDF.js from cdnjs when a PDF is selected, so an internet connection is required for that feature. Plain-text CVs work without it.

## Deploy free with GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select the `main` branch and `/(root)`.
4. Save and wait for the Pages URL to appear.

## How matching works

1. Frequent technical terms are extracted from the CV and research-interest text.
2. OpenAlex searches recent journal articles using the strongest terms.
3. Each title match receives more weight than an abstract match.
4. Excluded terms remove unwanted results.
5. The feed is ranked by the resulting relevance score.

This is intentionally simple and interpretable. A later version can add semantic embeddings, accounts, background journal monitoring, email digests, and AI summaries after the recommendation concept is validated.

## Data and privacy

The CV text, interests, selected journals, and saved-paper IDs are stored in browser `localStorage`. They are not uploaded to this repository or to an application server. Search terms are sent to OpenAlex when the feed is refreshed.

## License

MIT

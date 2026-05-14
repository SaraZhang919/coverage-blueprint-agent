# Context — Architecture Decisions & Agent Logic

This document explains *why* the system is built the way it is. Read this before making changes.
It is the source of truth for future Claude sessions or developers picking up this project.

---

## Purpose

The Coverage Blueprint Agent solves a specific SEO workflow problem:
> "Given a topic I want to rank for, what content do I need to write — and how complete is my existing content against what users search for and competitors cover?"

It combines three signal sources that are typically analysed separately and manually:
1. **Real user demand** (GSC queries)
2. **Market baseline** (what competitors cover)
3. **Latent user intent** (what GPT-4o knows users need even without explicit search data)

---

## Signal sources — why these three

| Source | What it tells us | Limitation |
|---|---|---|
| GSC queries | What real users actually search | Only shows queries your site already has impressions for |
| Competitor content | What the market considers table-stakes | Doesn't tell you what's *missing*, only what's *present* |
| LLM expansion | Query fan-out, latent intent, edge cases | Softest signal — not grounded in real data |

The three together compensate for each other's blind spots. GSC is ground truth but narrow. Competitors show breadth but no gaps. LLM catches what neither surfaces.

---

## Four coverage checks — the logic

### ① Intent match & clustering
**Why:** Raw GSC queries are noisy. Grouping them by intent type (informational, how-to, comparative, transactional, troubleshooting, definitional) reveals the *shape* of user demand — what kind of content is needed, not just what keywords appear.

**What it produces:** Clusters with a suggested article section per cluster. This is the structural skeleton.

**Scoring input:** GSC impressions (40%) + clicks (35%) + intent clarity (25%)

### ② Competitor consensus
**Why:** Topics covered by most competitors are table-stakes. Missing them is a ranking liability regardless of how good the rest of the article is. This check finds the non-negotiable gaps.

**What it produces:** Topics covered by 2+ competitors that aren't in the user's existing content.

**Threshold:** Only topics covered by 2+ competitors are surfaced. Single-competitor coverage is noise.

### ③ Differentiation opportunities
**Why:** Competing only on what everyone else covers leads to commodity content. This check finds high-importance topics that competitors haven't covered well — the content moat.

**What it produces:** 4–8 topics flagged as `diff` (differentiation). These become the "moat" sections — the reason a user would prefer this article over competitors.

**Scoring:** LLM-assessed user importance + inverse competitor coverage density

### ④ Query fan-out map
**Why:** Even well-structured articles miss sub-questions. A user searching "how to upscale video" actually has 15 sub-questions (what format? what quality? GPU requirements? free vs paid? etc.). This check simulates that full question space.

**What it produces:** Per-section question lists — every question the article must answer to achieve full coverage. This is the most actionable output for writers.

---

## Scoring weights — why these numbers

| Signal | Weight | Reasoning |
|---|---|---|
| GSC volume | 40% | Real data, real users. Cannot be gamed or hallucinated. |
| Competitor coverage density | 35% | Consensus signal. High density = the market has validated this topic matters. |
| LLM importance | 25% | Useful for surfacing gaps neither source catches, but it's the softest signal. |

These weights are intentionally conservative toward real data. The LLM is a useful supplement, not the primary signal.

**Changing weights:** Update the scoring logic inside `api/analyse.js` prompt instructions. The weights are described in natural language in each prompt — GPT-4o interprets them when generating `priorityScore` values. To make them precise, you would need to implement a post-processing scoring function in JavaScript after the API call.

---

## Architecture decisions

### Why Vercel Edge Functions (not Node.js serverless)?
Edge functions start faster (no cold start), run closer to the user, and are free on Vercel's hobby plan. The only limitation is no `fs` module — but we don't need it since all data is in-memory per request.

### Why vanilla HTML + inline JS (not React/Next.js)?
- Zero build step — edit a file, push to GitHub, Vercel deploys in 30 seconds
- No npm, no node_modules, no version conflicts
- The user (non-developer) can edit HTML/CSS directly in the GitHub web editor
- The app is a single-screen tool, not a complex SPA — a framework would add overhead with no benefit

### Why n8n for scraping and Sheets (not direct API calls from the frontend)?
Two reasons:
1. **CORS** — browsers block cross-origin requests to most websites. A server-side proxy (n8n) bypasses this.
2. **Google Sheets auth** — the API key would be exposed in the browser. n8n holds the Service Account credential server-side.

Vercel functions proxy the calls so the n8n URLs are also hidden from the browser (stored in env vars).

### Why Service Account for Google Sheets (not OAuth2)?
OAuth2 tokens expire. Service Account credentials don't. In n8n, OAuth2 requires re-authentication every few weeks. Service Account is set-and-forget. The trade-off is slightly more complex initial setup (create service account → download JSON → share sheet with service account email) but zero maintenance after.

### Why parallel scraping (not sequential in n8n)?
Each URL scrape takes 3–15 seconds. Sequential scraping of 6 URLs = up to 90 seconds of waiting. Parallel calls from the frontend = wait time equals the slowest single URL. The n8n workflow handles one URL per call — the frontend fires all calls simultaneously and collects results as they return.

### Why GPT-4o (not GPT-3.5 or GPT-4-turbo)?
- Intent clustering accuracy is significantly better — GPT-3.5 produces generic clusters
- Query fan-out quality is deeper — GPT-3.5 produces shallow, repetitive questions
- The cost difference per run is ~$0.05–0.15 vs ~$0.01 — negligible for this use case
- The blueprint is a high-stakes output (drives content investment decisions) — quality matters more than cost

---

## Data flow — full sequence

```
User uploads GSC CSV/XLSX
  → browser parses with SheetJS → state.gscData[]

User adds competitor URLs
  → browser fires parallel POST /api/scrape per URL
    → Vercel edge function → n8n scraper webhook
      → HTTP Request → Code (clean HTML) → Respond
    → returns { headings[], text, wordCount }
  → stored in state.urls[]

User selects structure mode (scratch / outline / article)
  → stored in state.structMode, state.existingStructure, state.existingArticle

User clicks Run Analysis
  → 4 sequential POST /api/analyse calls, each with checkType
    → Vercel edge function reads OPENAI_API_KEY from env
    → builds prompt with GSC data + competitor data + structure context
    → calls OpenAI GPT-4o
    → parses JSON response
    → returns structured data
  → browser merges all 4 results into state.blueprintRows[]
  → deduplicates by topic name
  → sorts by priorityScore descending

User reviews in table
  → approve / reject / edit per row
  → edit modal updates state.blueprintRows[i]

User exports
  → approved rows → POST /api/write
    → Vercel edge function → n8n writer webhook
      → Google Sheets append row
  → or CSV download (browser-side Blob)
```

---

## How to optimise prompts

### The one-file rule
All prompts live in `prompts.config.js` and nowhere else. `api/analyse.js` imports from it. Never edit prompts in `analyse.js`.

### Workflow for prompt iteration
1. Open `prompts.config.js` in GitHub (edit directly in browser — no local setup needed)
2. Find the prompt function you want to change (`intent`, `consensus`, `differentiation`, or `fanout`)
3. Read the tuning notes above each function — they list the specific levers to pull
4. Make your change — commit to GitHub
5. Vercel redeploys automatically in ~30 seconds
6. Open the app → turn on **Debug mode** (sidebar toggle) → run analysis
7. Debug panel shows: what prompt was sent, how many tokens were used, preview of the prompt
8. Inspect the review table output — does it match your intent?
9. Repeat until satisfied
10. Add an entry to `CHANGELOG.md` — which prompt, what changed, what improved

### Rules when editing prompts
1. Always keep `Return ONLY the JSON array/object` at the end of every prompt — GPT-4o will add prose if not instructed
2. The JSON field names must match what `mergeResults()` in `index.html` expects — see field reference in this file
3. Keep `max_tokens: 2000` in `analyse.js` — raising it increases cost and latency significantly
4. Temperature `0.3` is set in `analyse.js` — raise to `0.5` only for the differentiation prompt if output feels too conservative
5. Never remove the `DATA CONTEXT` block from prompts — it tells GPT-4o the time range for correct score calibration

### What each prompt variable receives
All prompts receive a context object. Available fields:

| Variable | Type | Description |
|---|---|---|
| `gscData` | array | Normalised GSC rows `{ query, impressions, clicks, position }` |
| `competitorData` | array | Scraped competitor data `{ url, headings[], text, wordCount }` |
| `seedTopic` | string | Target topic / seed keyword |
| `timeRange` | string | Human-readable e.g. "3 months" |
| `existingContext` | string | Pre-built context block about existing content |
| `structContext` | string | Fan-out specific context about existing structure |

### How to add a new field to prompt output
1. Add the field to the JSON schema in the relevant `PROMPTS.*` function in `prompts.config.js`
2. Add it to the `mergeResults()` function in `index.html` so it maps correctly
3. Add it to `renderReviewTable()` if it should appear in the review table
4. Add it to `exportSheets()` and `exportCSV()` if it should appear in the export
5. Add the column header to the Google Sheet manually

---
- `buildIntentPrompt()`
- `buildConsensusPrompt()`
- `buildDifferentiationPrompt()`
- `buildFanoutPrompt()`

Each function receives: `gscData`, `competitorData`, `existingStructure`, `existingArticle`, `existingType`, `seedTopic`, `structMode`.

**Rules when editing prompts:**
1. Always instruct GPT-4o to return **only JSON** — no preamble, no markdown fences
2. The JSON structure must match what `mergeResults()` in `index.html` expects
3. Keep `max_tokens: 2000` — increasing it significantly raises cost and latency
4. Temperature `0.3` is intentional — low enough for consistent JSON structure, high enough for creative gap identification

---

## Modifying the review table output

The review table is rendered by `renderReviewTable()` in `index.html`. Each row maps to a `blueprintRow` object:

```javascript
{
  topic: string,
  intent: 'informational'|'how-to'|'comparative'|'transactional'|'troubleshooting'|'definitional',
  priorityScore: number (0–100),
  coverage_status: 'gap'|'covered'|'diff',
  competitorCoverage: string,
  differentiation: boolean,
  fanOutQuestions: string[],
  recommendation: string,
  source: 'intent'|'consensus'|'diff'|'fanout'
}
```

To add a new column to the review table and export, add it here and update:
1. The relevant `build*Prompt()` function to request the new field
2. The `mergeResults()` function to map it
3. The `renderReviewTable()` function to display it
4. The `exportSheets()` and `exportCSV()` functions to include it in output

---

## Google Sheets column mapping

The `Blueprint_Output` sheet receives these columns in this order:

| Column | Source field | Notes |
|---|---|---|
| topic | `r.topic` | Section title |
| intent_type | `r.intent` | Intent cluster type |
| priority_score | `r.priorityScore` | 0–100 |
| coverage_status | `r.coverage_status` | gap / covered / diff |
| competitor_coverage | `r.competitorCoverage` | e.g. "3/5 competitors" |
| differentiation | `r.differentiation` | yes / no |
| fan_out_questions | `r.fanOutQuestions.join(' | ')` | Pipe-separated |
| recommendation | `r.recommendation` | Writer instruction |
| decision | `r.decision` | approve / edit |

To add columns: update the `payload` map in `exportSheets()` in `index.html`, and add the header to the Google Sheet manually.

---

## n8n HTML cleaning logic

The Code node in the scraper workflow strips noise in this order:
1. Remove: `<script>`, `<style>`, `<noscript>`, comments, `<svg>`, `<iframe>`, `<form>`
2. Remove: `<header>`, `<footer>`, `<nav>`, `<aside>`
3. Remove: elements with class/id containing cookie, banner, popup, modal, overlay, advertisement, sidebar
4. Extract headings: `h1`–`h6` with level and text
5. Extract content: `p`, `li`, `td`, `th`, `blockquote`, `figcaption` paragraphs >40 chars
6. Try to isolate `<main>` or `<article>` element for body text
7. Decode HTML entities, collapse whitespace
8. Truncate body text to 8000 chars

**Limitation:** JavaScript-rendered sites (React, Next.js, Vue SPAs) load content after the HTTP response — the raw HTML is a shell. The cleaner will return headings from static HTML but body text will be empty. The app handles this gracefully with a warning and manual paste fallback.

---

## Session state — what's in memory

All state lives in the `S` object in `index.html`. It is **not persisted** between page refreshes. If the user refreshes the page, all data is lost.

To add persistence in the future: serialize `S` to `localStorage` on each state change and rehydrate on load. This is listed in the backlog as a v1.1.0 feature.

---

## Who built this and when

- Built: May 2026
- Built with: Claude Sonnet 4.6 (Anthropic)
- Owner: Tiziana Zhang
- Repo: `coverage-blueprint-agent`

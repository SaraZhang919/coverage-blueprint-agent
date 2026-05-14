# Changelog

All notable changes to the Coverage Blueprint Agent are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.1.0] — Prompt management, time range handling, debug mode

### Added

**prompts.config.js — new file**
- All four GPT-4o prompts extracted into a single dedicated config file
- Prompts are now functions that receive a context object and return a string
- Tuning notes documented above each prompt explaining what levers to pull
- Edit this file only for prompt changes — never touch `api/analyse.js` for prompt work

**Time range selector (GSC upload step)**
- Four options: 28 days / 3 months (default) / 6 months / 12 months
- Reminder note added to GSC upload card explaining why 3 months is recommended
- Selected range shown in sidebar session chips

**GSC data normalisation**
- All impressions and clicks normalised to monthly averages before being sent to GPT-4o
- Prevents silent scoring errors where 28-day data scores ~3x lower than 3-month data for identical traffic
- Normalisation happens in `normaliseGSC()` in `api/analyse.js`
- GPT-4o prompt now explicitly states the time range for accurate score calibration

**Debug mode**
- Toggle in sidebar (Developer section)
- When ON: shows a debug panel on the analysis page after each run
- Panel shows per-check: prompt preview (first 300 chars), prompt length, tokens used, query count, competitor count, time range
- Persists across re-runs in the same session
- Use this to understand why GPT-4o produced a specific output and iterate on prompts

**Debug metadata in API responses**
- `api/analyse.js` now returns a `_debug` object alongside every result
- Contains: `checkType`, `timeRange`, `timeRangeMonths`, `normalisedQueryCount`, `competitorCount`, `promptLength`, `promptPreview`, `tokensUsed`
- Frontend stores this in `S.lastDebugData` for the debug panel

### Changed

- `api/analyse.js` refactored: prompts now imported from `prompts.config.js`, helper functions extracted (`normaliseGSC`, `formatTimeRange`, `buildExistingContext`, `buildStructContext`)
- `index.html` state object: added `timeRangeMonths`, `debugMode`, `lastDebugData`
- Sidebar: added time range chip, debug toggle with visual ON/OFF state
- All four prompts now include explicit time range context and monthly average framing

### Prompt changes in this version
- All prompts: added `DATA CONTEXT` section with time range and normalisation note
- Intent prompt: added `alreadyCovered` field, improved scoring formula description
- Consensus prompt: added explicit threshold rule (2+ competitors), improved recommendation specificity instruction
- Differentiation prompt: added heading hierarchy in competitor summary `[H2] heading`, improved rationale instruction
- Fan-out prompt: added query impression counts, deduplicated competitor headings, improved gap vs improvement framing

---

## [1.0.0] — Initial release

### Added

**Core pipeline**
- GSC query data ingestion — CSV and XLSX upload with in-browser parsing (SheetJS)
- Competitor URL scraping via n8n webhook — parallel fetch, per-URL status indicators
- Manual paste fallback UI for failed or JS-heavy competitor URLs
- Content structure input — three modes: scratch, existing outline, existing full article
- Four GPT-4o powered coverage checks running sequentially:
  - ① Intent match & clustering (GSC queries grouped by intent type)
  - ② Competitor consensus (table-stakes topics you're missing)
  - ③ Differentiation opportunities (content moat — high importance, low competitor coverage)
  - ④ Query fan-out map (every sub-question the article must answer per section)
- Results merger — deduplicates across all four checks, sorts by priority score

**Scoring**
- Composite priority score 0–100
- Weights: GSC volume 40% / Competitor density 35% / LLM importance 25%

**Human review gate**
- Summary table with approve / reject / edit decision per row
- Approve-all / reject-all batch actions
- Edit modal — edit topic title and recommendation notes inline
- Fan-out questions panel — click any row to expand its sub-questions
- Live counters: total / approved / pending

**Export**
- Google Sheets export via n8n writer webhook
- CSV download with datestamped filename
- Export summary showing approved / edited / rejected counts

**Infrastructure**
- Vercel Edge Functions for all API calls (OpenAI, scrape proxy, Sheets writer)
- OpenAI API key stored in Vercel environment variables — never exposed to browser
- n8n webhook URLs stored in Vercel environment variables
- Single-file frontend (index.html) — no build step, no framework, no npm

**n8n workflows**
- Competitor scraper: Webhook → HTTP Request → Code (HTML cleaner) → Respond
- Google Sheets writer: Webhook → Code (parse rows) → Google Sheets → Respond
- HTML cleaning pipeline: removes scripts, styles, nav, footer, SVG, modals; extracts h1–h6, p, li, article, main; collapses whitespace; strips HTML entities
- Google Sheets uses Service Account credential (not OAuth2) for reliability

---

## Backlog — planned for future versions

### v1.1.0 — UX improvements
- [ ] Adjustable scoring weight sliders in sidebar
- [ ] Session persistence (save/restore analysis state)
- [ ] Progress percentage indicator during analysis
- [ ] Keyboard shortcuts for approve/reject in review table
- [ ] Filter review table by coverage status or intent type

### v1.2.0 — Data enhancements
- [ ] SERP position column in GSC preview
- [ ] Competitor heading hierarchy visualisation (H1 → H2 → H3 tree)
- [ ] Query volume chart by intent cluster
- [ ] Side-by-side competitor coverage matrix

### v1.3.0 — Output enhancements
- [ ] Notion export via API
- [ ] PDF blueprint download
- [ ] Email blueprint via SendGrid or Resend
- [ ] Google Docs export

### v2.0.0 — Multi-article & team features
- [ ] Batch analysis for multiple articles/topics
- [ ] Saved project history
- [ ] Team sharing — shareable blueprint URLs
- [ ] Multi-language GSC data support
- [ ] Custom prompt templates per industry vertical

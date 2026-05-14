/**
 * prompts.config.js — Coverage Blueprint Agent
 *
 * ALL GPT-4o prompts live here and only here.
 * To tune prompt behaviour: edit this file, commit to GitHub, Vercel redeploys in ~30s.
 * Do NOT touch api/analyse.js for prompt changes — only for structural/API changes.
 *
 * Each prompt is a function that receives a context object and returns a string.
 * The JSON structure returned by GPT-4o must match what mergeResults() in index.html expects.
 * See CONTEXT.md → "Modifying prompts" for full field reference.
 *
 * Versioning: when you change a prompt, add an entry to CHANGELOG.md with:
 * - which prompt changed
 * - what you changed and why
 * - what result improved
 */

export const PROMPTS = {

  // ── ① Intent match & clustering ──────────────────────────────────────────
  //
  // Goal: group GSC queries by intent type, score by priority, suggest content sections.
  // Tuning levers:
  //   - Adjust the scoring formula description (impressions/clicks/intent weights)
  //   - Add or remove intent types in the enum
  //   - Change how existingContext is interpreted (stricter/looser "already covered" threshold)
  //   - Increase/decrease cluster granularity by adding examples
  //
  intent: ({ gscData, seedTopic, timeRange, existingContext }) => {
    const queryList = gscData.slice(0, 60).map(r =>
      `- "${r.query}" (monthly impressions: ${r.impressions}, monthly clicks: ${r.clicks}, position: ${r.position})`
    ).join('\n');

    return `You are an expert SEO content strategist analysing GSC query data for the topic: "${seedTopic}".

DATA CONTEXT: This data represents monthly averages from the last ${timeRange}.
${existingContext}

GSC QUERIES:
${queryList}

TASK: Cluster these queries by search intent. For each cluster:
- Identify the dominant intent type
- Calculate combined monthly impressions and clicks
- Suggest a concrete article section title
- Flag whether existing content already covers this cluster
- Score priority 0–100 using: monthly impression volume (40%) + click potential (35%) + intent clarity (25%)

Return a JSON array only. No preamble, no markdown, no explanation outside JSON.

[
  {
    "cluster": "short descriptive cluster name",
    "intent": "informational|how-to|comparative|transactional|troubleshooting|definitional",
    "queries": ["query1", "query2", "query3"],
    "totalImpressions": 0,
    "totalClicks": 0,
    "priorityScore": 0,
    "contentGap": "1–2 sentence description of what content is needed to satisfy this intent",
    "suggestedSection": "Concrete H2 section title for the article",
    "alreadyCovered": false
  }
]

Rules:
- Minimum 5 clusters, maximum 12
- alreadyCovered: true only if existing content clearly and specifically addresses this cluster
- suggestedSection must be a real, usable H2 heading — not generic like "More information"
- Return ONLY the JSON array`;
  },


  // ── ② Competitor consensus ────────────────────────────────────────────────
  //
  // Goal: find table-stakes topics covered by most competitors that the user is missing.
  // Tuning levers:
  //   - Change the minimum competitor coverage threshold (currently 2+)
  //   - Adjust how strictly "already covered" is assessed
  //   - Add industry-specific framing to the system context
  //   - Expand or reduce fanOutQuestions count per topic
  //
  consensus: ({ competitorData, gscData, timeRange, existingContext }) => {
    const compSummary = competitorData.map((c, i) =>
      `Competitor ${i + 1} (${c.url || 'unknown'}):\n  Headings: ${c.headings?.map(h => h.text).join(' | ') || 'none'}\n  Content preview: ${(c.text || '').substring(0, 400)}`
    ).join('\n\n');

    const topQueries = gscData.slice(0, 20).map(r => r.query).join(', ');

    return `You are an expert SEO content strategist performing competitor consensus analysis.

DATA CONTEXT: GSC data covers the last ${timeRange} (monthly averages shown).
Top user queries: ${topQueries}
${existingContext}

COMPETITOR CONTENT:
${compSummary}

TASK: Identify topics that 2 or more competitors cover that represent table-stakes content gaps.
These are non-negotiable — missing them is a ranking liability.

For each topic:
- Count exactly how many competitors cover it
- Assess how well it matches user search intent (high/medium/low)
- Check if the user's existing content already covers it
- Write a specific, actionable recommendation for what to include
- Generate 3 fan-out questions the section must answer

Return a JSON array only. No preamble, no markdown.

[
  {
    "topic": "specific topic name",
    "coverageCount": 3,
    "totalCompetitors": ${competitorData.length},
    "coveragePercent": 75,
    "intentMatch": "high|medium|low",
    "priorityScore": 0,
    "coverage_status": "gap",
    "alreadyCovered": false,
    "recommendation": "Specific actionable instruction for the writer — what to cover and how deep to go",
    "fanOutQuestions": [
      "Specific question this section must answer",
      "Another specific question",
      "A third specific question"
    ]
  }
]

Rules:
- ONLY include topics covered by 2+ competitors
- Score priority 0–100: competitor coverage density (50%) + intent match (30%) + search volume signal (20%)
- alreadyCovered: true only if user's existing content clearly addresses this topic
- recommendation must be specific and actionable, not generic
- Return ONLY the JSON array`;
  },


  // ── ③ Differentiation opportunities ──────────────────────────────────────
  //
  // Goal: surface high-importance topics competitors haven't covered — the content moat.
  // Tuning levers:
  //   - Change the min/max number of opportunities returned (currently 4–8)
  //   - Add domain-specific signals (e.g. "especially look for process/workflow gaps")
  //   - Adjust what counts as "not well covered" — stricter = fewer, looser = more
  //   - Add a "confidence" field to the output for human review prioritisation
  //
  differentiation: ({ competitorData, gscData, existingContext }) => {
    const compHeadings = competitorData.map((c, i) =>
      `Competitor ${i + 1} (${c.url || 'unknown'}): ${c.headings?.map(h => `[${h.level}] ${h.text}`).join(' | ') || 'none'}`
    ).join('\n');

    const topQueries = gscData.slice(0, 30).map(r => r.query).join('\n- ');

    return `You are an expert SEO content strategist identifying differentiation opportunities.

Your goal: find topics that matter to users but competitors have NOT covered well.
These become the content moat — the reason a reader would prefer this article over competitors.

USER QUERIES (what they actually search for):
- ${topQueries}

COMPETITOR CONTENT STRUCTURE:
${compHeadings}

${existingContext}

TASK: Identify 4–8 differentiation opportunities. Each must be:
1. Clearly important to users based on the query patterns above
2. Missing or only shallowly covered by competitors (not a main section in any competitor)
3. Not already well covered in the user's existing content (if provided)
4. Realistic to research and write about — not speculative

Return a JSON array only. No preamble, no markdown.

[
  {
    "topic": "specific topic name",
    "userImportance": "high|medium",
    "competitorCoverage": "none|minimal",
    "priorityScore": 0,
    "coverage_status": "diff",
    "rationale": "1–2 sentences: why users need this and why competitors missing it is an advantage",
    "recommendation": "Specific instruction: what angle to take, what depth, what format (table, checklist, step-by-step etc.)",
    "fanOutQuestions": [
      "Specific question this section must answer",
      "Another specific question",
      "A third specific question"
    ]
  }
]

Rules:
- Score priority 0–100: user importance (50%) + competitor gap size (30%) + query signal strength (20%)
- Do NOT include topics that are just slight variations of what competitors already cover well
- rationale must explain the *strategic* reason to cover this, not just describe the topic
- Return ONLY the JSON array`;
  },


  // ── ④ Query fan-out map ───────────────────────────────────────────────────
  //
  // Goal: simulate every question a user might ask — build the full question universe per section.
  // Tuning levers:
  //   - Change min/max sections (currently 8–14)
  //   - Adjust how deep the questions go (surface-level vs expert-level)
  //   - Add persona framing ("think like a beginner AND an expert")
  //   - Change how existing content is treated (gap-fill only vs full remap)
  //
  fanout: ({ gscData, competitorData, seedTopic, timeRange, structContext }) => {
    const topQueries = gscData.slice(0, 40).map(r =>
      `- "${r.query}" (${r.impressions} monthly impressions)`
    ).join('\n');

    const compHeadings = competitorData
      .flatMap(c => c.headings?.map(h => h.text) || [])
      .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
      .join(' | ')
      .substring(0, 1000);

    return `You are an expert SEO content strategist building a complete query fan-out map.

Topic: "${seedTopic}"
Data covers: last ${timeRange}

USER QUERIES FROM GSC:
${topQueries}

TOPICS COMPETITORS COVER: ${compHeadings}

CONTENT CONTEXT:
${structContext}

TASK: Simulate the full universe of questions a user might ask across their entire journey with this topic.
Think like both a complete beginner AND an expert practitioner.
For existing content: identify what's already answered and what's missing — focus on GAPS and IMPROVEMENTS.

Generate 8–14 sections that together form a complete article blueprint.

Return a JSON object only. No preamble, no markdown.

{
  "sections": [
    {
      "sectionTitle": "Concrete, specific H2 heading — not generic",
      "intent": "informational|how-to|comparative|transactional|troubleshooting",
      "priorityScore": 0,
      "coverage_status": "gap|covered|diff",
      "questions": [
        "Specific question this section must answer (not vague)",
        "Another specific question a real user would type or think",
        "A third question — can be beginner OR expert level",
        "Optional fourth question if the section warrants it"
      ],
      "recommendation": "Specific writer instruction: format, depth, examples to include, what NOT to include",
      "competitorCoverage": "covered by X/${competitorData.length} competitors|not covered by any competitor"
    }
  ]
}

Rules:
- sectionTitle must be a real, usable H2 — specific enough that a writer knows exactly what to write
- questions must be concrete and specific — not "what is X" but "what does X do when Y happens"
- coverage_status: "covered" if existing content addresses it, "gap" if missing, "diff" if it's an opportunity
- Score priority 0–100: search demand (40%) + competitor coverage gap (35%) + user journey importance (25%)
- recommendation must tell the writer: what format, what depth, what to include/exclude
- Return ONLY the JSON object`;
  }

};

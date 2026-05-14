export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) {
    return new Response(JSON.stringify({ error: 'OpenAI API key not configured in Vercel env vars' }), { status: 500 });
  }

  try {
    const body = await req.json();
    const { checkType, gscData, competitorData, existingStructure, existingArticle, existingType, seedTopic, structMode } = body;

    const prompts = {
      intent: buildIntentPrompt(gscData, seedTopic, existingStructure, existingArticle, existingType, structMode),
      consensus: buildConsensusPrompt(competitorData, gscData, existingStructure, existingArticle, existingType, structMode),
      differentiation: buildDifferentiationPrompt(competitorData, gscData, existingStructure, existingArticle, existingType, structMode),
      fanout: buildFanoutPrompt(gscData, competitorData, seedTopic, structMode, existingStructure, existingArticle, existingType)
    };

    const prompt = prompts[checkType];
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Invalid checkType' }), { status: 400 });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are an expert SEO content strategist. Your job is to analyse content coverage gaps and opportunities.
Always respond with valid JSON only. No markdown, no preamble, no explanation outside the JSON structure.`
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: `OpenAI error: ${err}` }), { status: 500 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';

    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

function buildIntentPrompt(gscData, seedTopic, existingStructure, existingArticle, existingType, structMode) {
  const queryList = gscData.slice(0, 60).map(r =>
    `- "${r.query}" (impressions: ${r.impressions || 0}, clicks: ${r.clicks || 0}, position: ${r.position || 0})`
  ).join('\n');

  let existingContext = '';
  if (structMode !== 'scratch') {
    if (existingType === 'article' && existingArticle) {
      existingContext = `\n\nThe user has an existing article. Extract what topics are already covered from this text, then identify gaps:\n---\n${existingArticle.substring(0, 3000)}\n---`;
    } else if (existingStructure) {
      existingContext = `\n\nExisting content structure to evaluate coverage against:\n${existingStructure}`;
    }
  }

  return `You are analysing GSC query data for the topic: "${seedTopic}".

Here are the top queries:
${queryList}
${existingContext}

Task: Cluster these queries by search intent and score each cluster by priority. For each cluster, flag whether the existing content already covers it or if it's a gap.

Return a JSON array of clusters in this exact format:
[
  {
    "cluster": "cluster name",
    "intent": "informational|how-to|comparative|transactional|troubleshooting|definitional",
    "queries": ["query1", "query2"],
    "totalImpressions": 0,
    "totalClicks": 0,
    "priorityScore": 0,
    "contentGap": "brief description of what content is needed",
    "suggestedSection": "suggested article section title",
    "alreadyCovered": false
  }
]

Score priority 0-100 based on: impression volume (40%), click potential (35%), intent clarity (25%).
Set alreadyCovered to true only if the existing content clearly addresses this cluster.
Return only the JSON array.`;
}

function buildConsensusPrompt(competitorData, gscData, existingStructure, existingArticle, existingType, structMode) {
  const compSummary = competitorData.map((c, i) =>
    `Competitor ${i + 1} (${c.url}):\nHeadings: ${c.headings?.map(h => h.text).join(' | ') || 'none'}\nContent: ${(c.text || '').substring(0, 500)}`
  ).join('\n\n');

  const topQueries = gscData.slice(0, 20).map(r => r.query).join(', ');

  let existingContext = '';
  if (structMode !== 'scratch') {
    if (existingType === 'article' && existingArticle) {
      existingContext = `\n\nUser's existing article (check what's already covered):\n${existingArticle.substring(0, 2000)}`;
    } else if (existingStructure) {
      existingContext = `\n\nUser's existing structure:\n${existingStructure}`;
    }
  }

  return `You are analysing competitor content coverage.

Top user queries: ${topQueries}

Competitor content:
${compSummary}
${existingContext}

Task: Identify topics that MOST competitors cover (consensus topics) that the user is missing. These are table-stakes gaps.

Return a JSON array in this exact format:
[
  {
    "topic": "topic name",
    "coverageCount": 3,
    "totalCompetitors": ${competitorData.length},
    "coveragePercent": 75,
    "intentMatch": "high|medium|low",
    "priorityScore": 0,
    "coverage_status": "gap",
    "alreadyCovered": false,
    "recommendation": "what to write about this topic",
    "fanOutQuestions": ["question 1", "question 2", "question 3"]
  }
]

Only include topics covered by 2+ competitors. Set alreadyCovered true if user's existing content clearly covers it already.
Score priority 0-100. Return only the JSON array.`;
}

function buildDifferentiationPrompt(competitorData, gscData, existingStructure, existingArticle, existingType, structMode) {
  const compHeadings = competitorData.map((c, i) =>
    `Competitor ${i + 1}: ${c.headings?.map(h => h.text).join(' | ') || 'none'}`
  ).join('\n');

  const topQueries = gscData.slice(0, 30).map(r => r.query).join(', ');

  let existingContext = '';
  if (structMode !== 'scratch') {
    if (existingType === 'article' && existingArticle) {
      existingContext = `\n\nUser's existing article:\n${existingArticle.substring(0, 2000)}`;
    } else if (existingStructure) {
      existingContext = `\n\nUser's existing structure:\n${existingStructure}`;
    }
  }

  return `You are identifying content differentiation opportunities — topics important to users that competitors have NOT covered well.

User queries: ${topQueries}

Competitor headings:
${compHeadings}
${existingContext}

Task: Identify 4-8 topics that:
1. Are important to users based on the queries
2. Are NOT well covered by competitors
3. Would create a content advantage if covered
4. Are not already in the user's existing content (if provided)

Return a JSON array in this exact format:
[
  {
    "topic": "topic name",
    "userImportance": "high|medium",
    "competitorCoverage": "none|minimal",
    "priorityScore": 0,
    "coverage_status": "diff",
    "rationale": "why this matters to users",
    "recommendation": "how to cover this topic uniquely",
    "fanOutQuestions": ["question 1", "question 2", "question 3"]
  }
]

Return only the JSON array.`;
}

function buildFanoutPrompt(gscData, competitorData, seedTopic, structMode, existingStructure, existingArticle, existingType) {
  const topQueries = gscData.slice(0, 40).map(r => r.query).join('\n- ');
  const compHeadings = competitorData.flatMap(c => c.headings?.map(h => h.text) || []).join(' | ');

  let structContext = '';
  if (structMode === 'scratch') {
    structContext = 'No existing structure — generate a complete blueprint from scratch.';
  } else if (existingType === 'article' && existingArticle) {
    structContext = `The user has an existing article. First extract its structure, then identify what's missing and generate the full fan-out map including gaps:\n\n${existingArticle.substring(0, 3000)}`;
  } else if (existingStructure) {
    structContext = `Existing content structure:\n${existingStructure}`;
  }

  return `You are generating a complete query fan-out map for the topic: "${seedTopic}".

User queries from GSC:
- ${topQueries}

Competitor topics covered: ${compHeadings.substring(0, 800)}

${structContext}

Task: Simulate every question a user might ask at each stage of their journey. Generate a comprehensive list of questions the article MUST answer to achieve full coverage. For existing content, include sections to ADD or IMPROVE — not just what already exists.

Return a JSON object in this exact format:
{
  "sections": [
    {
      "sectionTitle": "section heading for the article",
      "intent": "informational|how-to|comparative|transactional|troubleshooting",
      "priorityScore": 0,
      "coverage_status": "gap|covered|diff",
      "questions": [
        "specific question this section must answer",
        "another question"
      ],
      "recommendation": "what to include in this section",
      "competitorCoverage": "covered by X/Y competitors|not covered"
    }
  ]
}

Generate 8-14 sections. Mark covered sections as "covered", missing ones as "gap", differentiation opportunities as "diff".
Score priority 0-100. Return only the JSON object.`;
}

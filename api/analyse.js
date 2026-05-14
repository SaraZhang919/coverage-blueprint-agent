/**
 * api/analyse.js — Coverage Blueprint Agent
 *
 * Handles OpenAI GPT-4o API calls for all four coverage checks.
 * DO NOT edit prompts here — edit prompts.config.js instead.
 * This file handles: request routing, data normalisation, API call, response parsing.
 */

import { PROMPTS } from '../prompts.config.js';

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
    const {
      checkType,
      gscData,
      competitorData,
      existingStructure,
      existingArticle,
      existingType,
      seedTopic,
      structMode,
      timeRangeMonths = 3
    } = body;

    // Normalise GSC data to monthly averages
    const normalisedGSC = normaliseGSC(gscData, timeRangeMonths);
    const timeRange = formatTimeRange(timeRangeMonths);
    const existingContext = buildExistingContext(structMode, existingType, existingStructure, existingArticle);
    const structContext = buildStructContext(structMode, existingType, existingStructure, existingArticle);

    // Build prompt via prompts.config.js
    let prompt;
    switch (checkType) {
      case 'intent':
        prompt = PROMPTS.intent({ gscData: normalisedGSC, seedTopic, timeRange, existingContext });
        break;
      case 'consensus':
        prompt = PROMPTS.consensus({ competitorData, gscData: normalisedGSC, timeRange, existingContext });
        break;
      case 'differentiation':
        prompt = PROMPTS.differentiation({ competitorData, gscData: normalisedGSC, existingContext });
        break;
      case 'fanout':
        prompt = PROMPTS.fanout({ gscData: normalisedGSC, competitorData, seedTopic, timeRange, structContext });
        break;
      default:
        return new Response(JSON.stringify({ error: `Invalid checkType: ${checkType}` }), { status: 400 });
    }

    // Call OpenAI GPT-4o
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
            content: `You are an expert SEO content strategist. Always respond with valid JSON only. No markdown fences, no preamble, no explanation outside the JSON structure. Your JSON must be parseable by JSON.parse() without any preprocessing.`
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
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      return new Response(JSON.stringify({
        error: 'JSON parse failed',
        raw: clean.substring(0, 500),
        parseError: parseErr.message
      }), { status: 500 });
    }

    // Return result with debug metadata
    return new Response(JSON.stringify({
      ...parsed,
      _debug: {
        checkType,
        timeRange,
        timeRangeMonths,
        normalisedQueryCount: normalisedGSC.length,
        competitorCount: competitorData?.length || 0,
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 300) + '...',
        tokensUsed: data.usage?.total_tokens || null
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normaliseGSC(gscData, months) {
  if (!gscData?.length) return [];
  const m = Math.max(1, months);
  return gscData.map(r => ({
    ...r,
    impressions: Math.round((parseInt(r.impressions) || 0) / m),
    clicks: Math.round((parseInt(r.clicks) || 0) / m),
    position: parseFloat(r.position) || 0
  }));
}

function formatTimeRange(months) {
  const map = { 1: '28 days', 3: '3 months', 6: '6 months', 12: '12 months' };
  return map[months] || `${months} months`;
}

function buildExistingContext(structMode, existingType, existingStructure, existingArticle) {
  if (structMode === 'scratch') return 'EXISTING CONTENT: None — generating blueprint from scratch.';
  if (existingType === 'article' && existingArticle)
    return `EXISTING CONTENT (full article — extract covered topics from this):\n---\n${existingArticle.substring(0, 3000)}\n---`;
  if (existingStructure)
    return `EXISTING CONTENT STRUCTURE:\n${existingStructure}`;
  return 'EXISTING CONTENT: None provided.';
}

function buildStructContext(structMode, existingType, existingStructure, existingArticle) {
  if (structMode === 'scratch')
    return 'No existing structure — generate a complete blueprint from scratch covering all angles.';
  if (existingType === 'article' && existingArticle)
    return `Existing article — extract structure, identify what is already answered, focus fan-out on GAPS:\n\n${existingArticle.substring(0, 3000)}`;
  if (existingStructure)
    return `Existing outline — focus on what is missing:\n\n${existingStructure}`;
  return 'No existing structure — generate complete blueprint from scratch.';
}

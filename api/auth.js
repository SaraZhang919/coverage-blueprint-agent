/**
 * api/auth.js — Coverage Blueprint Agent
 *
 * Validates the access passphrase.
 * Only requires ONE env var: ACCESS_PASSPHRASE
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: corsHeaders()
    });
  }

  const PASSPHRASE = process.env.ACCESS_PASSPHRASE;

  if (!PASSPHRASE) {
    return new Response(JSON.stringify({ error: 'Auth not configured — set ACCESS_PASSPHRASE in Vercel env vars' }), {
      status: 500, headers: corsHeaders()
    });
  }

  try {
    const { passphrase } = await req.json();

    if (!passphrase || passphrase.trim() !== PASSPHRASE.trim()) {
      await new Promise(r => setTimeout(r, 500));
      return new Response(JSON.stringify({ error: 'Incorrect passphrase' }), {
        status: 401, headers: corsHeaders()
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: corsHeaders()
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders()
    });
  }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

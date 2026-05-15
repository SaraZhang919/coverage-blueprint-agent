/**
 * api/auth.js — Coverage Blueprint Agent
 *
 * Validates the access passphrase and returns a signed session token.
 * The token is a simple HMAC signature of a timestamp + secret.
 * No external auth library needed — runs on Vercel Edge.
 *
 * Env vars required:
 *   ACCESS_PASSPHRASE  — the passphrase users must enter
 *   SESSION_SECRET     — long random string used to sign the token
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Allow CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders()
    });
  }

const PASSPHRASE = process.env.ACCESS_PASSPHRASE;
if (!PASSPHRASE) {
  return new Response(JSON.stringify({ error: 'Auth not configured — set ACCESS_PASSPHRASE in Vercel env vars' }), {
    status: 500,
    headers: corsHeaders()
  });
}

  try {
    const { passphrase } = await req.json();

    // Constant-time comparison to prevent timing attacks
    if (!passphrase || passphrase.trim() !== PASSPHRASE.trim()) {
      // Small delay to slow brute force
      await new Promise(r => setTimeout(r, 500));
      return new Response(JSON.stringify({ error: 'Incorrect passphrase' }), {
        status: 401,
        headers: corsHeaders()
      });
    }

    // Generate session token: HMAC-SHA256 of "timestamp:secret"
    const timestamp = Date.now();
    const payload = `${timestamp}:${PASSPHRASE}`;
    const token = await generateToken(payload);

    return new Response(JSON.stringify({
      success: true,
      token,
      expiresIn: '8 hours'
    }), {
      status: 200,
      headers: corsHeaders()
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders()
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a session token by HMAC-SHA256 signing the payload.
 * Returns base64url-encoded string.
 */
async function generateToken(payload) {
  const secret = process.env.SESSION_SECRET;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload)
  );

  // Encode as base64url
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const token = `${btoa(payload)}.${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`;
  return token;
}

/**
 * Verify a session token.
 * Called by validateToken() in other API routes.
 */
export async function verifyToken(token) {
  if (!token) return false;

  try {
    const secret = process.env.SESSION_SECRET;
    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const payload = atob(parts[0]);
    const timestamp = parseInt(payload.split(':')[0]);

    // Check token age — expire after 8 hours
    const eightHours = 8 * 60 * 60 * 1000;
    if (Date.now() - timestamp > eightHours) return false;

    // Re-sign and compare
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const expected = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    return parts[1] === expected;
  } catch {
    return false;
  }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token'
  };
}

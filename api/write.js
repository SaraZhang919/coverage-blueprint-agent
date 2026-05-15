/**
 * api/write.js — Coverage Blueprint Agent
 * Proxy to n8n Google Sheets writer webhook.
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const N8N_WRITER = process.env.N8N_WRITER_WEBHOOK;
  if (!N8N_WRITER) {
    return new Response(JSON.stringify({ error: 'N8N_WRITER_WEBHOOK not configured' }), { status: 500 });
  }

  try {
    const body = await req.json();
    const rows = Array.isArray(body) ? body : [body];

    const response = await fetch(N8N_WRITER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows)
    });

    if (!response.ok) throw new Error(`n8n writer returned ${response.status}`);
    const result = await response.json();

    return new Response(JSON.stringify({ success: true, rowsWritten: rows.length, result }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

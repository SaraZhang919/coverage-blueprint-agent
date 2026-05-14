export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const N8N_SCRAPER = process.env.N8N_SCRAPER_WEBHOOK;
  if (!N8N_SCRAPER) {
    return new Response(JSON.stringify({ error: 'N8N_SCRAPER_WEBHOOK not configured' }), { status: 500 });
  }

  try {
    const { url } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL is required' }), { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let result;
    try {
      const response = await fetch(N8N_SCRAPER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`n8n returned ${response.status}`);
      }

      result = await response.json();
    } catch (fetchErr) {
      clearTimeout(timeout);
      return new Response(JSON.stringify({
        success: false,
        url,
        error: fetchErr.name === 'AbortError' ? 'Request timed out (20s)' : fetchErr.message,
        headings: [],
        text: '',
        wordCount: 0
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // n8n returns array — unwrap if needed
    const data = Array.isArray(result) ? result[0] : result;

    return new Response(JSON.stringify({
      success: data.success || false,
      url,
      headings: data.headings || [],
      headingCount: data.headingCount || 0,
      text: data.text || '',
      wordCount: data.wordCount || 0,
      error: data.error || null
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message, headings: [], text: '' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

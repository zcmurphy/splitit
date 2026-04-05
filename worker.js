// ============================================================
// SplitIt — Anthropic API Proxy + KV Session Store
// Cloudflare Worker v2
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ══ SESSION ROUTES /session ══════════════════════════════
    if (url.pathname === '/session') {
      if (request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) return json({ error: 'Missing id' }, 400);
        if (!env.SPLITIT_SESSIONS) return json({ error: 'KV not configured' }, 500);
        const data = await env.SPLITIT_SESSIONS.get(id);
        if (!data) return json({ error: 'Session not found or expired' }, 404);
        return new Response(data, { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      }
      if (request.method === 'POST') {
        if (!env.SPLITIT_SESSIONS) return json({ error: 'KV not configured' }, 500);
        let body;
        try { body = await request.json(); } catch(e) { return json({ error: 'Invalid JSON' }, 400); }
        const id = body.sessionId;
        if (!id) return json({ error: 'Missing sessionId' }, 400);
        await env.SPLITIT_SESSIONS.put(id, JSON.stringify(body), { expirationTtl: 86400 });
        return json({ id, ok: true });
      }
      if (request.method === 'PATCH') {
        const id = url.searchParams.get('id');
        if (!id) return json({ error: 'Missing id' }, 400);
        if (!env.SPLITIT_SESSIONS) return json({ error: 'KV not configured' }, 500);
        const existing = await env.SPLITIT_SESSIONS.get(id);
        if (!existing) return json({ error: 'Session not found' }, 404);
        let session, patch;
        try { session = JSON.parse(existing); patch = await request.json(); } catch(e) { return json({ error: 'Invalid JSON' }, 400); }
        // Merge claims
        session.claims = { ...session.claims, ...patch.claims };
        // Merge items (assignees) — match by id, update assignees
        if (patch.items && Array.isArray(patch.items)) {
          patch.items.forEach(patchItem => {
            const idx = session.items.findIndex(i => String(i.id) === String(patchItem.id));
            if (idx !== -1) session.items[idx].assignees = patchItem.assignees;
          });
        }
        await env.SPLITIT_SESSIONS.put(id, JSON.stringify(session), { expirationTtl: 86400 });
        return json({ ok: true, claims: session.claims });
      }
      return json({ error: 'Method not allowed' }, 405);
    }

    // ══ ANTHROPIC PROXY POST / ════════════════════════════════
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'API key not configured' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch(e) {
      return json({ error: 'Invalid JSON body', detail: e.message }, 400);
    }

    const allowedModels = ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'];
    if (!allowedModels.includes(body.model)) {
      return json({ error: `Model not permitted: ${body.model}` }, 403);
    }

    // Validate image media_type if present
    const allowedMediaTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    for (const msg of (body.messages || [])) {
      for (const block of (Array.isArray(msg.content) ? msg.content : [])) {
        if (block.type === 'image' && block.source?.media_type) {
          if (!allowedMediaTypes.includes(block.source.media_type)) {
            return json({ error: `Unsupported image type: ${block.source.media_type}. Use jpeg, png, gif, or webp.` }, 400);
          }
        }
      }
    }

    if (!body.max_tokens || body.max_tokens > 2000) body.max_tokens = 1500;

    let anthropicResponse;
    try {
      anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch(e) {
      return json({ error: 'Failed to reach Anthropic API', detail: e.message }, 502);
    }

    const responseBody = await anthropicResponse.text();
    return new Response(responseBody, {
      status: anthropicResponse.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://zcmurphy.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

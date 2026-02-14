// Netlify Function: Track tool usage per company email via Upstash Redis.
// GET  ?email=x → returns { count, allowed }
// POST { email } → increments count, returns { count, allowed }
//
// Storage: Upstash Redis (free tier, REST API).
// Netlify Blobs was tried but fails in esbuild-bundled functions.
//
// Exempt emails (unlimited usage): jose@mantyl.ai
// All other emails: max 2 uses, then blocked.

const MAX_FREE_USES = 2;
const EXEMPT_EMAILS = ['jose@mantyl.ai'];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function isExempt(email) {
  return EXEMPT_EMAILS.includes(normalizeEmail(email));
}

// ── Upstash Redis REST helpers ──
async function redisCommand(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null; // Redis not configured — fail open
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.result;
  } catch (e) {
    console.error(`[Usage] Redis error: ${e.message}`);
    return null;
  }
}

async function getUsageData(email) {
  const raw = await redisCommand(['GET', `usage:${email}`]);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* ignore */ }
  }
  return null;
}

async function setUsageData(email, data) {
  const result = await redisCommand(['SET', `usage:${email}`, JSON.stringify(data)]);
  return result === 'OK';
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const redisConfigured = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

  try {
    if (event.httpMethod === 'GET') {
      const email = normalizeEmail(event.queryStringParameters?.email);
      if (!email) return respond(400, { error: 'email parameter required' });

      if (isExempt(email)) {
        return respond(200, { email, count: 0, allowed: true, exempt: true });
      }

      if (!redisConfigured) {
        return respond(200, { email, count: 0, allowed: true, fallback: true });
      }

      const data = await getUsageData(email);
      const count = data?.count || 0;
      return respond(200, { email, count, allowed: count < MAX_FREE_USES });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const email = normalizeEmail(body.email);
      if (!email) return respond(400, { error: 'email required in body' });

      if (isExempt(email)) {
        return respond(200, { email, count: 0, allowed: true, exempt: true });
      }

      if (!redisConfigured) {
        return respond(200, { email, count: 0, allowed: true, fallback: true });
      }

      const data = await getUsageData(email);
      const prevCount = data?.count || 0;
      const newCount = prevCount + 1;

      const writeOk = await setUsageData(email, {
        count: newCount,
        lastUsed: new Date().toISOString(),
        firstUsed: data?.firstUsed || new Date().toISOString(),
      });

      if (!writeOk) {
        console.error(`[Usage] Write failed for ${email}`);
        return respond(200, { email, count: prevCount, allowed: prevCount < MAX_FREE_USES, writeError: true });
      }

      console.log(`[Usage] ${email}: ${prevCount} → ${newCount} (limit: ${MAX_FREE_USES})`);
      return respond(200, { email, count: newCount, allowed: newCount < MAX_FREE_USES });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[Usage] Error:', err.message);
    return respond(200, { count: 0, allowed: true, error: 'tracking_unavailable' });
  }
}

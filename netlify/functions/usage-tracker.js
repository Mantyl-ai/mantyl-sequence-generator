// Netlify Function: Track tool usage per company email via Netlify Blobs.
// GET  ?email=x → returns { count, allowed }
// POST { email } → increments count, returns { count, allowed }
//
// Exempt emails (unlimited usage): jose@mantyl.ai
// All other emails: max 2 uses, then blocked.
import { getStore } from '@netlify/blobs';

const STORE_OPTIONS = { name: 'usage-tracker', consistency: 'strong' };
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

async function getStoreData(store, key) {
  try {
    const data = await store.get(key, { type: 'json' });
    return data;
  } catch (e) {
    // Blob not found or store empty — this is normal for first-time users
    console.log(`[Usage] No blob for "${key}": ${e.message}`);
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    let store;
    try {
      store = getStore(STORE_OPTIONS);
    } catch (storeErr) {
      // If Netlify Blobs is not available, fail open (allow usage)
      console.error('[Usage] Cannot init blob store:', storeErr.message);
      const email = normalizeEmail(
        event.httpMethod === 'GET'
          ? event.queryStringParameters?.email
          : JSON.parse(event.body || '{}').email
      );
      return respond(200, { email, count: 0, allowed: true, fallback: true });
    }

    if (event.httpMethod === 'GET') {
      // Check usage for an email
      const email = normalizeEmail(event.queryStringParameters?.email);
      if (!email) return respond(400, { error: 'email parameter required' });

      if (isExempt(email)) {
        return respond(200, { email, count: 0, allowed: true, exempt: true });
      }

      const data = await getStoreData(store, email);
      const count = data?.count || 0;
      return respond(200, { email, count, allowed: count < MAX_FREE_USES });
    }

    if (event.httpMethod === 'POST') {
      // Increment usage for an email
      const body = JSON.parse(event.body || '{}');
      const email = normalizeEmail(body.email);
      if (!email) return respond(400, { error: 'email required in body' });

      if (isExempt(email)) {
        return respond(200, { email, count: 0, allowed: true, exempt: true });
      }

      const data = await getStoreData(store, email);
      const prevCount = data?.count || 0;
      const newCount = prevCount + 1;

      try {
        await store.setJSON(email, {
          count: newCount,
          lastUsed: new Date().toISOString(),
          firstUsed: data?.firstUsed || new Date().toISOString(),
        });
      } catch (writeErr) {
        // If we can't write, still return the count but log the error
        console.error(`[Usage] Write failed for ${email}:`, writeErr.message);
        return respond(200, { email, count: prevCount, allowed: prevCount < MAX_FREE_USES, writeError: true });
      }

      console.log(`[Usage] ${email}: ${prevCount} → ${newCount} (limit: ${MAX_FREE_USES})`);

      return respond(200, {
        email,
        count: newCount,
        allowed: newCount < MAX_FREE_USES,
      });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[Usage] Error:', err.message, err.stack);
    // Fail open — don't block users due to tracking errors
    return respond(200, { count: 0, allowed: true, error: 'tracking_unavailable' });
  }
}

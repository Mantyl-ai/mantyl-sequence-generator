// Netlify Function: Receive + serve async Clay enrichment data
// POST: Clay's HTTP API action sends enriched data here after processing
// GET:  Frontend polls this function to retrieve Clay-enriched data
//
// Uses /tmp/ storage (same pattern as phone-webhook.js)
// Clay sends one POST per prospect with enriched fields.
//
// Expected Clay POST payload:
// {
//   prospect_index: 0,           // Index in our prospects array
//   email: "found@email.com",    // Clay-found email (if needs_email was true)
//   email_status: "verified",    // Clay's email verification status
//   phone: "+1234567890",        // Clay-found phone (if needs_phone was true)
//   phone_type: "mobile",        // Phone type if available
//   linkedin_url: "https://...", // Clay-found LinkedIn (if needs_linkedin was true)
//   enrichment_source: "clay",   // Always "clay"
// }

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

const STORE_DIR = '/tmp/clay-store';

// Ensure store dir exists on cold start
try { mkdirSync(STORE_DIR, { recursive: true }); } catch (e) { /* exists */ }

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const sessionId = extractSessionId(event);

  // ── GET: Frontend polls for Clay-enriched data ──
  if (event.httpMethod === 'GET') {
    if (!sessionId) return respond(400, { error: 'Missing sessionId' });

    const data = readStore(sessionId);
    return respond(200, {
      enrichments: data.enrichments || {},
      totalReceived: data.totalReceived || 0,
      status: data.totalReceived > 0 ? 'has_data' : 'waiting',
    });
  }

  // ── POST: Clay sends enriched data ──
  if (event.httpMethod !== 'POST') {
    return respond(200, { ok: true, note: 'Clay webhook ready' });
  }

  try {
    if (!sessionId) {
      console.warn('[clay-webhook] POST without sessionId. Path:', event.path);
      return respond(400, { error: 'Missing sessionId' });
    }

    const body = JSON.parse(event.body || '{}');
    console.log(`[clay-webhook] Session ${sessionId} received payload: ${JSON.stringify(body).slice(0, 500)}`);

    // Clay may send a single object or an array
    const records = Array.isArray(body) ? body : [body];
    const existing = readStore(sessionId);

    for (const record of records) {
      const idx = record.prospect_index;
      if (idx === undefined || idx === null) {
        console.warn('[clay-webhook] Record missing prospect_index, skipping');
        continue;
      }

      const enrichment = {};
      let fieldsFound = 0;

      // Only capture fields that Clay actually found (non-empty)
      if (record.email && record.email.includes('@')) {
        enrichment.email = record.email.trim();
        enrichment.emailStatus = record.email_status || 'clay_enriched';
        fieldsFound++;
      }

      if (record.phone) {
        const phone = String(record.phone).trim();
        if (phone.length >= 7) {
          enrichment.phone = phone;
          enrichment.phoneType = record.phone_type || '';
          fieldsFound++;
        }
      }

      if (record.linkedin_url && record.linkedin_url.includes('linkedin.com')) {
        enrichment.linkedinUrl = record.linkedin_url.trim();
        fieldsFound++;
      }

      if (fieldsFound > 0) {
        enrichment.source = 'clay';
        enrichment.receivedAt = new Date().toISOString();
        existing.enrichments[String(idx)] = {
          ...(existing.enrichments[String(idx)] || {}),
          ...enrichment,
        };
        existing.totalReceived = (existing.totalReceived || 0) + 1;
        console.log(`[clay-webhook] Prospect ${idx}: found ${fieldsFound} field(s) — ${Object.keys(enrichment).filter(k => k !== 'source' && k !== 'receivedAt').join(', ')}`);
      } else {
        console.log(`[clay-webhook] Prospect ${idx}: Clay returned no new data`);
      }
    }

    writeStore(sessionId, existing);
    console.log(`[clay-webhook] Stored results for session ${sessionId}. Total received: ${existing.totalReceived}`);

    return respond(200, { ok: true, stored: records.length });

  } catch (err) {
    console.error('[clay-webhook] Error:', err.message, err.stack);
    return respond(200, { ok: true, note: 'Error handled' }); // Always 200 to Clay
  }
}

// ── /tmp/ file storage helpers ──
function readStore(sessionId) {
  try {
    const filePath = `${STORE_DIR}/${sessionId}.json`;
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    }
  } catch (e) { /* file doesn't exist or parse error */ }
  return { enrichments: {}, totalReceived: 0 };
}

function writeStore(sessionId, data) {
  const filePath = `${STORE_DIR}/${sessionId}.json`;
  writeFileSync(filePath, JSON.stringify(data));
}

function extractSessionId(event) {
  // Try path-based: /clay-webhook/{sessionId}
  const pathParts = (event.path || '').split('/').filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1];
  if (lastPart && lastPart !== 'clay-webhook') return lastPart;
  // Fallback to query param
  return event.queryStringParameters?.sessionId || '';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

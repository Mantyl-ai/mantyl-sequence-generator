// Netlify Function: Receive + serve async phone data from Apollo webhook
// POST: Apollo sends waterfall phone data here after /people/match enrichment
// GET:  Frontend polls this same function to retrieve stored phone data
//
// Using /tmp/ storage (shared within same function's Lambda container)
// This works because both POST (webhook) and GET (polling) hit the same function.
//
// Apollo waterfall payload format:
// { people: [{ id, waterfall: { phone_numbers: [{ vendors: [{ phone_numbers: [...], status }] }] } }] }

import { promises as fs } from 'fs';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

const STORE_DIR = '/tmp/phone-store';

// Ensure store dir exists on cold start
try { mkdirSync(STORE_DIR, { recursive: true }); } catch (e) { /* exists */ }

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const sessionId = extractSessionId(event);

  // ── GET: Frontend polls for phone data ──
  if (event.httpMethod === 'GET') {
    if (!sessionId) return respond(400, { error: 'Missing sessionId' });

    const data = readStore(sessionId);
    return respond(200, {
      phones: data.phones || {},
      totalReceived: data.totalReceived || 0,
      status: data.totalReceived > 0 ? 'has_data' : 'waiting',
    });
  }

  // ── POST: Apollo sends phone webhook data ──
  if (event.httpMethod !== 'POST') {
    return respond(200, { ok: true, note: 'Webhook ready' });
  }

  try {
    if (!sessionId) {
      console.warn('[phone-webhook] POST without sessionId. Path:', event.path);
      return respond(400, { error: 'Missing sessionId' });
    }

    const body = JSON.parse(event.body || '{}');
    console.log(`[phone-webhook] Session ${sessionId} received payload (${JSON.stringify(body).length} bytes)`);

    // ── Parse Apollo waterfall payload ──
    const people = body.people || [];
    if (people.length === 0) {
      console.log('[phone-webhook] No people in payload, checking alternate format');
      // Try alternate format: body itself might be the person
      const altPerson = body.person || body;
      if (altPerson.id || altPerson.phone_numbers) {
        people.push(altPerson);
      }
    }

    const results = [];

    for (const person of people) {
      const personId = person.id || '';
      const personName = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim();
      const personEmail = person.email || '';
      const personLinkedin = person.linkedin_url || '';

      // Extract phone numbers from waterfall vendors
      const verifiedPhones = [];
      const allPhones = [];
      const waterfallSteps = person.waterfall?.phone_numbers || [];

      for (const step of waterfallSteps) {
        for (const vendor of (step.vendors || [])) {
          const vendorPhones = vendor.phone_numbers || [];
          for (const phone of vendorPhones) {
            if (typeof phone === 'string' && phone.trim()) {
              allPhones.push({
                number: phone.trim(),
                vendor: vendor.name || vendor.id || 'unknown',
                status: vendor.status || 'unknown',
              });
              if (vendor.status === 'VERIFIED') {
                verifiedPhones.push(phone.trim());
              }
            }
          }
        }
      }

      // Also check flat phone_numbers array (non-waterfall format)
      const flatPhones = person.phone_numbers || [];
      for (const p of flatPhones) {
        const num = typeof p === 'string' ? p : (p.sanitized_number || p.number || p.raw_number || '');
        if (num) {
          allPhones.push({ number: num, vendor: 'direct', status: p.type || 'unknown' });
          verifiedPhones.push(num);
        }
      }

      // Pick best phone: prefer shorter numbers (direct lines), skip extensions
      const cleanPhones = verifiedPhones
        .map(p => p.replace(/\s*x\d+$/, '').trim()) // Remove extensions like "x6192"
        .filter(p => p.length >= 10);
      const bestPhone = cleanPhones[0] || verifiedPhones[0] || (allPhones[0]?.number) || '';

      // Determine phone type from flat phone_numbers array if available
      // Waterfall phones don't have type, but flat phone_numbers do ("work_direct" or "mobile")
      let phoneType = '';
      if (flatPhones.length > 0) {
        phoneType = flatPhones[0].type || '';
      }

      console.log(`[phone-webhook] Person "${personName}" (${personId}): ${verifiedPhones.length} verified, ${allPhones.length} total. Best: "${bestPhone}" (${phoneType})`);

      results.push({ personId, name: personName, email: personEmail, linkedin: personLinkedin, phone: bestPhone, phoneType, allPhones, verifiedPhones });
    }

    // ── Store results in /tmp/ ──
    const existing = readStore(sessionId);

    for (const r of results) {
      const entry = {
        phone: r.phone,
        phoneType: r.phoneType || '',
        allPhones: r.allPhones,
        verifiedPhones: r.verifiedPhones,
        name: r.name,
        receivedAt: new Date().toISOString(),
      };

      if (r.personId) existing.phones[`id:${r.personId}`] = entry;
      if (r.email) existing.phones[`email:${r.email.toLowerCase()}`] = entry;
      if (r.linkedin) existing.phones[`linkedin:${r.linkedin}`] = entry;
      if (r.name) existing.phones[`name:${r.name.toLowerCase()}`] = entry;
      existing.totalReceived = (existing.totalReceived || 0) + 1;
    }

    writeStore(sessionId, existing);
    console.log(`[phone-webhook] Stored ${results.length} results for session ${sessionId}. Total received: ${existing.totalReceived}`);

    return respond(200, { ok: true, stored: results.length, phones: results.map(r => r.phone).filter(Boolean) });

  } catch (err) {
    console.error('[phone-webhook] Error:', err.message, err.stack);
    return respond(200, { ok: true, note: 'Error handled' }); // Always 200 to Apollo
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
  return { phones: {}, totalReceived: 0 };
}

function writeStore(sessionId, data) {
  const filePath = `${STORE_DIR}/${sessionId}.json`;
  writeFileSync(filePath, JSON.stringify(data));
}

function extractSessionId(event) {
  // Try path-based: /phone-webhook/{sessionId}
  const pathParts = (event.path || '').split('/').filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1];
  if (lastPart && lastPart !== 'phone-webhook') return lastPart;
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

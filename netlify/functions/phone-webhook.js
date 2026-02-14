// Netlify Function: Receive + serve async phone data from Apollo webhook
// POST: Apollo sends waterfall phone data here after /people/match enrichment
// GET:  Frontend polls this same function to retrieve stored phone data
//
// Storage: Upstash Redis (free tier, REST API, no SDK needed).
// Uses HSET/HGETALL for atomic writes — prevents race conditions when
// multiple Apollo webhook calls arrive simultaneously.
//
// Apollo waterfall payload format:
// { people: [{ id, waterfall: { phone_numbers: [{ vendors: [{ phone_numbers: [...], status }] }] } }] }

// Redis key TTL: 1 hour (phone polling only runs ~2 min, this is generous)
const TTL_SECONDS = 3600;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const sessionId = extractSessionId(event);

  // ── GET: Frontend polls for phone data ──
  if (event.httpMethod === 'GET') {
    if (!sessionId) return respond(400, { error: 'Missing sessionId' });

    const storageOk = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    const data = await readPhoneHash(sessionId);
    return respond(200, {
      phones: data.phones,
      totalReceived: data.totalReceived,
      status: data.totalReceived > 0 ? 'has_data' : 'waiting',
      storageOk,
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
        .map(p => p.replace(/\s*x\d+$/, '').trim())
        .filter(p => p.length >= 10);
      const bestPhone = cleanPhones[0] || verifiedPhones[0] || (allPhones[0]?.number) || '';

      let phoneType = '';
      if (flatPhones.length > 0) {
        phoneType = flatPhones[0].type || '';
      }

      console.log(`[phone-webhook] Person "${personName}" (${personId}): ${verifiedPhones.length} verified, ${allPhones.length} total. Best: "${bestPhone}" (${phoneType})`);

      results.push({ personId, name: personName, email: personEmail, linkedin: personLinkedin, phone: bestPhone, phoneType, allPhones, verifiedPhones });
    }

    // ── Store results atomically in Redis using HSET ──
    // Each person gets multiple hash fields (id, email, linkedin, name) pointing to their phone data.
    // HSET is atomic per call — no read-modify-write race condition when concurrent webhook POSTs arrive.
    const hashKey = `phone:${sessionId}`;
    const fieldsToSet = [];

    for (const r of results) {
      const entry = JSON.stringify({
        phone: r.phone,
        phoneType: r.phoneType || '',
        allPhones: r.allPhones,
        verifiedPhones: r.verifiedPhones,
        name: r.name,
        receivedAt: new Date().toISOString(),
      });

      // Add all identifier keys for this person — frontend matches by any of these
      if (r.personId) fieldsToSet.push(`id:${r.personId}`, entry);
      if (r.email) fieldsToSet.push(`email:${r.email.toLowerCase()}`, entry);
      if (r.linkedin) fieldsToSet.push(`linkedin:${r.linkedin}`, entry);
      if (r.name) fieldsToSet.push(`name:${r.name.toLowerCase()}`, entry);
    }

    let writeOk = true;
    if (fieldsToSet.length > 0) {
      // HSET adds fields atomically — concurrent calls don't overwrite each other
      const hsetResult = await redisCommand(['HSET', hashKey, ...fieldsToSet]);
      writeOk = hsetResult !== null;

      // Atomically increment the received counter
      await redisCommand(['HINCRBY', hashKey, '_totalReceived', results.length]);

      // Set TTL (refreshed on each POST — keeps data alive while webhook calls are arriving)
      await redisCommand(['EXPIRE', hashKey, TTL_SECONDS]);
    }

    console.log(`[phone-webhook] Stored ${results.length} results (${fieldsToSet.length / 2} hash fields) for session ${sessionId}. Write OK: ${writeOk}`);

    return respond(200, { ok: true, stored: results.length, writeOk, phones: results.map(r => r.phone).filter(Boolean) });

  } catch (err) {
    console.error('[phone-webhook] Error:', err.message, err.stack);
    return respond(200, { ok: true, note: 'Error handled' }); // Always 200 to Apollo
  }
}

// ── Upstash Redis REST helpers ──

async function redisCommand(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn('[phone-webhook] Upstash Redis not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Netlify env vars.');
    return null;
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

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[phone-webhook] Redis error: ${res.status} ${errText}`);
      return null;
    }

    const data = await res.json();
    return data.result;
  } catch (e) {
    console.error(`[phone-webhook] Redis fetch error: ${e.message}`);
    return null;
  }
}

/**
 * Read all phone data from Redis hash using HGETALL.
 * Returns { phones: { key: entryObj, ... }, totalReceived: N }
 */
async function readPhoneHash(sessionId) {
  const hashKey = `phone:${sessionId}`;
  const raw = await redisCommand(['HGETALL', hashKey]);

  // HGETALL returns an array of alternating [key, value, key, value, ...]
  // or an object { key: value } depending on the Upstash client
  const phones = {};
  let totalReceived = 0;

  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) {
      const field = raw[i];
      const value = raw[i + 1];
      if (field === '_totalReceived') {
        totalReceived = parseInt(value) || 0;
      } else {
        try {
          phones[field] = JSON.parse(value);
        } catch {
          phones[field] = value;
        }
      }
    }
  } else if (raw && typeof raw === 'object') {
    // Upstash REST sometimes returns an object directly
    for (const [field, value] of Object.entries(raw)) {
      if (field === '_totalReceived') {
        totalReceived = parseInt(value) || 0;
      } else {
        try {
          phones[field] = JSON.parse(value);
        } catch {
          phones[field] = value;
        }
      }
    }
  }

  return { phones, totalReceived };
}

function extractSessionId(event) {
  const pathParts = (event.path || '').split('/').filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1];
  if (lastPart && lastPart !== 'phone-webhook') return lastPart;
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

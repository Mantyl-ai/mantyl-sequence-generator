// Netlify Function: Receive async phone data from Apollo webhook
// Apollo sends phone numbers asynchronously after a /people/match call
// with reveal_phone_number=true. This webhook stores the data in Netlify Blobs
// so the frontend can poll for it via get-phones.js.

import { getStore } from "@netlify/blobs";

export async function handler(event) {
  // Allow CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  // Apollo sends POST with phone data
  if (event.httpMethod !== 'POST') {
    return respond(200, { ok: true, note: 'Webhook ready' });
  }

  try {
    const sessionId = event.queryStringParameters?.sessionId;
    if (!sessionId) {
      console.warn('Phone webhook called without sessionId');
      return respond(400, { error: 'Missing sessionId' });
    }

    const body = JSON.parse(event.body || '{}');
    console.log(`Phone webhook received for session ${sessionId}:`, JSON.stringify(body).slice(0, 500));

    // Extract phone data from Apollo's webhook payload
    // Apollo sends person data with phone_numbers array
    const person = body.person || body;
    const phoneNumbers = person.phone_numbers || [];
    const personId = person.id || '';
    const email = person.email || '';
    const name = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim();
    const linkedinUrl = person.linkedin_url || '';

    // Pick the best phone number (prefer direct, then mobile, then any)
    let bestPhone = '';
    if (phoneNumbers.length > 0) {
      const direct = phoneNumbers.find(p => p.type === 'work_direct' || p.type === 'direct');
      const mobile = phoneNumbers.find(p => p.type === 'mobile');
      const first = phoneNumbers[0];
      const chosen = direct || mobile || first;
      bestPhone = chosen.sanitized_number || chosen.number || chosen.raw_number || '';
    }

    if (!bestPhone) {
      console.log(`Phone webhook for session ${sessionId}: no usable phone number found in payload`);
      // Still store it so we know we received the webhook for this person
    }

    // Store in Netlify Blobs
    const store = getStore("phone-data");
    const existing = await store.get(sessionId, { type: "json" }).catch(() => null) || { phones: {}, receivedAt: [] };

    // Index by multiple keys for matching (person ID, email, linkedin, name)
    const phoneEntry = {
      phone: bestPhone,
      allPhones: phoneNumbers.map(p => ({
        number: p.sanitized_number || p.number || '',
        type: p.type || 'unknown',
      })),
      name,
      receivedAt: new Date().toISOString(),
    };

    if (personId) existing.phones[`id:${personId}`] = phoneEntry;
    if (email) existing.phones[`email:${email.toLowerCase()}`] = phoneEntry;
    if (linkedinUrl) existing.phones[`linkedin:${linkedinUrl}`] = phoneEntry;
    if (name) existing.phones[`name:${name.toLowerCase()}`] = phoneEntry;

    existing.receivedAt.push(new Date().toISOString());

    await store.setJSON(sessionId, existing);

    console.log(`Stored phone "${bestPhone}" for session ${sessionId} (${name}). Total entries: ${existing.receivedAt.length}`);

    return respond(200, { ok: true, stored: !!bestPhone });

  } catch (err) {
    console.error('Phone webhook error:', err);
    return respond(200, { ok: true, note: 'Error handled' }); // Always return 200 to Apollo
  }
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

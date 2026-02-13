// Netlify Function: Return phone data stored by phone-webhook.js
// The frontend polls this endpoint after prospects are loaded to check
// if Apollo has delivered any phone numbers via the async webhook.

import { getStore } from "@netlify/blobs";

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    const sessionId = event.queryStringParameters?.sessionId;
    if (!sessionId) {
      return respond(400, { error: 'Missing sessionId' });
    }

    const store = getStore("phone-data");
    const data = await store.get(sessionId, { type: "json" }).catch(() => null);

    if (!data || !data.phones) {
      return respond(200, {
        phones: {},
        totalReceived: 0,
        status: 'waiting',
      });
    }

    // Build a lookup map for the frontend: match by name, email, or linkedin
    const phoneLookup = {};
    for (const [key, entry] of Object.entries(data.phones)) {
      if (entry.phone) {
        phoneLookup[key] = entry.phone;
      }
    }

    return respond(200, {
      phones: phoneLookup,
      totalReceived: data.receivedAt?.length || 0,
      status: Object.keys(phoneLookup).length > 0 ? 'found' : 'waiting',
    });

  } catch (err) {
    console.error('Get phones error:', err);
    return respond(200, { phones: {}, totalReceived: 0, status: 'error' });
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

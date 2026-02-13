// Netlify Function: Find prospects via Apollo People Search, optionally enrich via Clay
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
  if (!APOLLO_API_KEY) {
    return respond(500, {
      error: 'Apollo API key not configured. Add APOLLO_API_KEY to your Netlify environment variables. ' +
        'Get your free API key at app.apollo.io → Settings → Integrations → API Keys.'
    });
  }

  try {
    const body = JSON.parse(event.body);
    const { industry, companySegment, companySize, jobTitles, geography, techStack, otherCriteria, prospectCount = 10 } = body;

    // Cap at 20 prospects
    const count = Math.min(parseInt(prospectCount) || 10, 20);

    // ── Step 1: Search for people via Apollo ──────────────────────────
    // Apollo's People Search API — searches 270M+ contacts by ICP filters
    // This endpoint does NOT consume credits (search is free)
    const apolloFilters = buildApolloFilters({ industry, companySegment, companySize, jobTitles, geography, techStack });

    const apolloResponse = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': APOLLO_API_KEY,
      },
      body: JSON.stringify({
        per_page: count,
        page: 1,
        ...apolloFilters,
      }),
    });

    if (!apolloResponse.ok) {
      const errText = await apolloResponse.text();
      console.error('Apollo API error:', apolloResponse.status, errText);
      throw new Error(
        `Apollo API returned ${apolloResponse.status}. ` +
        `Please verify your APOLLO_API_KEY in Netlify environment variables. ` +
        `Get your key at app.apollo.io → Settings → Integrations → API Keys.`
      );
    }

    const apolloData = await apolloResponse.json();
    let prospects = normalizeApolloProspects(apolloData);

    // ── Step 2 (Optional): Enrich via Clay webhook ───────────────────
    // If CLAY_WEBHOOK_URL is configured, send prospects to Clay for
    // verified email/phone enrichment. Otherwise, return Apollo data as-is.
    const CLAY_WEBHOOK_URL = process.env.CLAY_WEBHOOK_URL;
    const CLAY_WEBHOOK_AUTH = process.env.CLAY_WEBHOOK_AUTH;

    if (CLAY_WEBHOOK_URL && prospects.length > 0) {
      try {
        prospects = await enrichViaClay(prospects, CLAY_WEBHOOK_URL, CLAY_WEBHOOK_AUTH);
      } catch (clayErr) {
        // Clay enrichment is optional — if it fails, return Apollo data
        console.warn('Clay enrichment failed, returning Apollo data:', clayErr.message);
      }
    }

    return respond(200, {
      prospects,
      total: prospects.length,
      source: CLAY_WEBHOOK_URL ? 'apollo+clay' : 'apollo',
    });

  } catch (err) {
    console.error('Error finding prospects:', err);
    return respond(500, { error: err.message || 'Failed to find prospects' });
  }
}

// ── Apollo filter builder ────────────────────────────────────────────
function buildApolloFilters({ industry, companySegment, companySize, jobTitles, geography, techStack }) {
  const filters = {};

  // Job titles → person_titles array
  if (jobTitles) {
    const titles = typeof jobTitles === 'string'
      ? jobTitles.split(',').map(t => t.trim()).filter(Boolean)
      : jobTitles;
    if (titles.length > 0) {
      filters.person_titles = titles;
    }
  }

  // Industry → q_organization_keyword_tags
  if (industry) {
    const industries = Array.isArray(industry) ? industry : [industry];
    filters.q_organization_keyword_tags = industries;
  }

  // Company size → organization_num_employees_ranges
  // Apollo uses string ranges like "1,10", "11,20", "21,50", etc.
  if (companySize) {
    const sizeMap = {
      '1-10':        ['1,10'],
      '11-20':       ['11,20'],
      '21-50':       ['21,50'],
      '51-100':      ['51,100'],
      '101-200':     ['101,200'],
      '201-500':     ['201,500'],
      '501-1,000':   ['501,1000'],
      '1,001-2,000': ['1001,2000'],
      '2,001-5,000': ['2001,5000'],
      '5,001-10,000':['5001,10000'],
      '10,001+':     ['10001,'],
    };
    if (sizeMap[companySize]) {
      filters.organization_num_employees_ranges = sizeMap[companySize];
    }
  } else if (companySegment) {
    const segmentMap = {
      'SMB':        ['1,200'],
      'Midmarket':  ['201,1000'],
      'Enterprise': ['1001,'],
    };
    if (segmentMap[companySegment]) {
      filters.organization_num_employees_ranges = segmentMap[companySegment];
    }
  }

  // Geography → person_locations
  if (geography) {
    const locations = Array.isArray(geography) ? geography : [geography];
    filters.person_locations = locations;
  }

  // Tech stack → q_organization_keyword_tags (append to industry tags)
  if (techStack) {
    const tools = typeof techStack === 'string'
      ? techStack.split(',').map(t => t.trim()).filter(Boolean)
      : techStack;
    if (tools.length > 0) {
      // Apollo uses organization_keyword_tags for both industry and tech
      filters.q_organization_keyword_tags = [
        ...(filters.q_organization_keyword_tags || []),
        ...tools,
      ];
    }
  }

  return filters;
}

// ── Normalize Apollo response to prospect format ─────────────────────
function normalizeApolloProspects(data) {
  const rawPeople = data.people || data.contacts || [];

  return rawPeople.map(person => {
    const org = person.organization || {};

    return {
      name: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown',
      title: person.title || person.headline || '',
      company: org.name || person.organization_name || '',
      email: person.email || '',
      phone: person.phone_number || person.sanitized_phone || '',
      linkedinUrl: person.linkedin_url || '',
      location: person.city
        ? `${person.city}${person.state ? ', ' + person.state : ''}${person.country ? ', ' + person.country : ''}`
        : person.country || '',
      companyDomain: org.primary_domain || org.website_url || '',
      companyIndustry: org.industry || '',
      companySize: org.estimated_num_employees || '',
      enrichmentStatus: getEnrichmentStatus(person),
    };
  });
}

// ── Optional Clay enrichment via webhook ─────────────────────────────
// Sends prospect data to your Clay table webhook for verified email/phone
// enrichment. Clay processes asynchronously, so this does a fire-and-forget
// POST. For real-time enrichment, you'd need a callback or polling mechanism.
async function enrichViaClay(prospects, webhookUrl, authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['x-clay-webhook-auth'] = authToken;
  }

  // Send each prospect to Clay for enrichment
  // Clay webhook tables accept one record per POST
  const enrichmentPromises = prospects.map(async (prospect) => {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: prospect.name,
          job_title: prospect.title,
          company: prospect.company,
          company_domain: prospect.companyDomain,
          linkedin_url: prospect.linkedinUrl,
          industry: prospect.companyIndustry,
          company_size: prospect.companySize,
          location: prospect.location,
        }),
      });

      if (!response.ok) {
        console.warn(`Clay webhook failed for ${prospect.name}:`, response.status);
      }
    } catch (err) {
      console.warn(`Clay webhook error for ${prospect.name}:`, err.message);
    }
  });

  await Promise.all(enrichmentPromises);

  // Note: Clay enriches asynchronously. The webhook fires and Clay processes
  // in the background. For now we return Apollo data immediately.
  // Enriched data (verified emails, phones) will appear in your Clay table.
  // A future enhancement could poll Clay or use a Clay HTTP API callback
  // to wait for enrichment results before returning.
  return prospects;
}

// ── Enrichment status helper ─────────────────────────────────────────
function getEnrichmentStatus(person) {
  const hasEmail = !!person.email;
  const hasPhone = !!(person.phone_number || person.sanitized_phone);
  const hasLinkedin = !!person.linkedin_url;

  if (hasEmail && hasPhone && hasLinkedin) return 'enriched';
  if (hasEmail || hasLinkedin) return 'partial';
  return 'minimal';
}

// ── CORS + Response helpers ──────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

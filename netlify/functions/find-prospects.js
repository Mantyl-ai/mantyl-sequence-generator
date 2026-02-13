// Netlify Function: Find prospects via Apollo People Search + Enrichment
// Step 1: Search (free, no credits) → Step 2: Enrich (1 credit/person for email)
// Optional Step 3: Clay webhook enrichment for additional data
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

    // ── Step 1: Search for people via Apollo (FREE — no credits) ─────
    const apolloFilters = buildApolloFilters({ industry, companySegment, companySize, jobTitles, geography, techStack });

    const apolloResponse = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
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
    const rawPeople = apolloData.people || apolloData.contacts || [];

    // ── Step 2: Enrich each person via Apollo Match (1 credit/person) ─
    // The search endpoint doesn't return email/phone/linkedin.
    // We call /people/match for each person to get contact details.
    let prospects = await enrichProspects(rawPeople, APOLLO_API_KEY);

    // ── Step 3 (Optional): Additional enrichment via Clay webhook ────
    const CLAY_WEBHOOK_URL = process.env.CLAY_WEBHOOK_URL;
    const CLAY_WEBHOOK_AUTH = process.env.CLAY_WEBHOOK_AUTH;

    if (CLAY_WEBHOOK_URL && prospects.length > 0) {
      try {
        prospects = await enrichViaClay(prospects, CLAY_WEBHOOK_URL, CLAY_WEBHOOK_AUTH);
      } catch (clayErr) {
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

// ── Apollo Enrichment — get email, phone, LinkedIn for each person ───
async function enrichProspects(rawPeople, apiKey) {
  const enrichmentPromises = rawPeople.map(async (person) => {
    try {
      const org = person.organization || {};
      const firstName = person.first_name || '';
      const lastName = person.last_name || '';
      const domain = org.primary_domain || org.website_url || '';

      // Call Apollo People Match endpoint to get contact details
      const matchResponse = await fetch('https://api.apollo.io/api/v1/people/match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          organization_name: org.name || person.organization_name || '',
          domain: domain,
          reveal_personal_emails: true,
        }),
      });

      if (matchResponse.ok) {
        const matchData = await matchResponse.json();
        const enrichedPerson = matchData.person || matchData;

        return {
          name: enrichedPerson.name || person.name || `${firstName} ${lastName}`.trim() || 'Unknown',
          title: enrichedPerson.title || person.title || person.headline || '',
          company: (enrichedPerson.organization || {}).name || org.name || person.organization_name || '',
          email: enrichedPerson.email || '',
          phone: enrichedPerson.phone_number || enrichedPerson.sanitized_phone || '',
          linkedinUrl: enrichedPerson.linkedin_url || '',
          location: formatLocation(enrichedPerson) || formatLocation(person) || '',
          companyDomain: (enrichedPerson.organization || {}).primary_domain || domain || '',
          companyIndustry: (enrichedPerson.organization || {}).industry || org.industry || '',
          companySize: (enrichedPerson.organization || {}).estimated_num_employees || org.estimated_num_employees || '',
          enrichmentStatus: getEnrichmentStatus(enrichedPerson),
        };
      } else {
        console.warn(`Apollo enrichment failed for ${firstName} ${lastName}:`, matchResponse.status);
        // Fall back to search-only data (no email/phone/linkedin)
        return normalizeSearchPerson(person);
      }
    } catch (err) {
      console.warn(`Apollo enrichment error for ${person.name || 'unknown'}:`, err.message);
      return normalizeSearchPerson(person);
    }
  });

  return Promise.all(enrichmentPromises);
}

// ── Format location from person object ──────────────────────────────
function formatLocation(person) {
  if (!person) return '';
  if (person.city) {
    return `${person.city}${person.state ? ', ' + person.state : ''}${person.country ? ', ' + person.country : ''}`;
  }
  return person.country || '';
}

// ── Fallback: normalize search-only person (no enrichment) ──────────
function normalizeSearchPerson(person) {
  const org = person.organization || {};
  return {
    name: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown',
    title: person.title || person.headline || '',
    company: org.name || person.organization_name || '',
    email: '',
    phone: '',
    linkedinUrl: '',
    location: formatLocation(person),
    companyDomain: org.primary_domain || org.website_url || '',
    companyIndustry: org.industry || '',
    companySize: org.estimated_num_employees || '',
    enrichmentStatus: 'minimal',
  };
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

  // Industry → q_keywords (broad keyword search, much more forgiving than q_organization_keyword_tags)
  // We strip separators like " / ", " & ", " - " and send as a clean keyword string
  if (industry) {
    const industryKeywords = industry
      .replace(/[\/&\-–—]/g, ' ')     // Replace separators with spaces
      .replace(/\s+/g, ' ')            // Collapse whitespace
      .trim();
    filters.q_keywords = industryKeywords;
  }

  // Company size → organization_num_employees_ranges
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

  // Tech stack → q_organization_keyword_tags (specific tool names match well as keyword tags)
  if (techStack) {
    const tools = typeof techStack === 'string'
      ? techStack.split(',').map(t => t.trim()).filter(Boolean)
      : techStack;
    if (tools.length > 0) {
      filters.q_organization_keyword_tags = tools;
    }
  }

  console.log('Apollo filters:', JSON.stringify(filters, null, 2));
  return filters;
}

// ── Optional Clay enrichment via webhook ─────────────────────────────
async function enrichViaClay(prospects, webhookUrl, authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['x-clay-webhook-auth'] = authToken;
  }

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

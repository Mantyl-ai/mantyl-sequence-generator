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

    // Validate Apollo response shape — guard against unexpected API changes
    if (!apolloData || typeof apolloData !== 'object') {
      console.error('Apollo returned non-object response:', typeof apolloData);
      throw new Error('Apollo API returned an unexpected response format');
    }

    const rawPeople = apolloData.people || apolloData.contacts || [];
    if (!Array.isArray(rawPeople)) {
      console.error('Apollo people/contacts is not an array:', typeof rawPeople);
      throw new Error('Apollo API returned an unexpected data structure');
    }

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
// Batches requests (5 at a time) to avoid Apollo rate limits when enriching 20 people
async function enrichProspects(rawPeople, apiKey) {
  const BATCH_SIZE = 5;
  const BATCH_DELAY = 1000; // 1s between batches to avoid rate limits
  const results = [];

  for (let i = 0; i < rawPeople.length; i += BATCH_SIZE) {
    const batch = rawPeople.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(person => enrichOnePerson(person, apiKey)));
    results.push(...batchResults);

    // Brief pause between batches (skip after last batch)
    if (i + BATCH_SIZE < rawPeople.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  return results;
}

async function enrichOnePerson(person, apiKey) {
  try {
    const org = person.organization || {};
    const firstName = person.first_name || '';
    const lastName = person.last_name || '';
    const domain = org.primary_domain || org.website_url || '';

    // Also try to get email directly from the search result
    const searchEmail = person.email || '';
    const searchLinkedin = person.linkedin_url || '';
    const searchPhone = person.phone_number || person.sanitized_phone || '';

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

      // Log what we got back for debugging
      const gotEmail = !!(enrichedPerson.email);
      const gotLinkedin = !!(enrichedPerson.linkedin_url);
      console.log(`Enrichment for ${firstName} ${lastName}: email=${gotEmail}, linkedin=${gotLinkedin}, status=${matchResponse.status}`);

      return {
        name: enrichedPerson.name || person.name || `${firstName} ${lastName}`.trim() || 'Unknown',
        title: enrichedPerson.title || person.title || person.headline || '',
        company: (enrichedPerson.organization || {}).name || org.name || person.organization_name || '',
        email: enrichedPerson.email || searchEmail || '',
        phone: enrichedPerson.phone_number || enrichedPerson.sanitized_phone || searchPhone || '',
        linkedinUrl: enrichedPerson.linkedin_url || searchLinkedin || '',
        location: formatLocation(enrichedPerson) || formatLocation(person) || '',
        companyDomain: (enrichedPerson.organization || {}).primary_domain || domain || '',
        companyIndustry: (enrichedPerson.organization || {}).industry || org.industry || '',
        companySize: (enrichedPerson.organization || {}).estimated_num_employees || org.estimated_num_employees || '',
        enrichmentStatus: getEnrichmentStatus(enrichedPerson),
      };
    } else {
      const errText = await matchResponse.text().catch(() => '');
      console.warn(`Apollo enrichment failed for ${firstName} ${lastName}: ${matchResponse.status} ${errText.slice(0, 200)}`);
      // Fall back to search-only data — but still use any data from the search endpoint
      const fallback = normalizeSearchPerson(person);
      fallback.email = searchEmail || fallback.email;
      fallback.linkedinUrl = searchLinkedin || fallback.linkedinUrl;
      fallback.phone = searchPhone || fallback.phone;
      if (fallback.email || fallback.linkedinUrl) fallback.enrichmentStatus = 'partial';
      return fallback;
    }
  } catch (err) {
    console.warn(`Apollo enrichment error for ${person.name || 'unknown'}:`, err.message);
    return normalizeSearchPerson(person);
  }
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

  // Industry → q_organization_keyword_tags (ARRAY of company-level keyword tags)
  // IMPORTANT: q_keywords searches person profiles (titles, descriptions), NOT company industry.
  // q_organization_keyword_tags searches company-level keyword tags — which is what we need.
  // Apollo treats these as OR — any matching tag will include the company.
  // We split our compound industry names into individual keywords for broader matching.
  // NOTE: Tech stack also uses this param — we merge both below.
  const orgKeywordTags = [];
  if (industry && industry.trim() && industry.trim().toLowerCase() !== 'other') {
    const industryTags = industry
      .split(/\s*[\/&–—]\s*/)          // Split on " / ", " & ", " – ", " — " separators
      .map(tag => tag.trim())
      .filter(tag => tag.length > 1);  // Drop single-char noise like "L", "D" from "L&D"

    orgKeywordTags.push(...industryTags);
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
  // Expand abstract region names to country lists Apollo understands
  if (geography) {
    const regionExpansion = {
      'Global':         ['United States', 'United Kingdom', 'Germany', 'Canada', 'Australia', 'France', 'India'],
      'Americas':       ['United States', 'Canada', 'Brazil', 'Mexico', 'Argentina', 'Colombia', 'Chile'],
      'Latin America':  ['Brazil', 'Mexico', 'Argentina', 'Colombia', 'Chile', 'Peru'],
      'EMEA':           ['United Kingdom', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Switzerland', 'Israel', 'United Arab Emirates', 'South Africa'],
      'Nordics':        ['Sweden', 'Norway', 'Denmark', 'Finland'],
      'Eastern Europe': ['Poland', 'Czech Republic', 'Romania', 'Hungary', 'Ukraine'],
      'Middle East':    ['United Arab Emirates', 'Saudi Arabia', 'Israel', 'Qatar', 'Bahrain', 'Kuwait'],
      'Africa':         ['South Africa', 'Nigeria', 'Kenya', 'Egypt', 'Ghana'],
      'APAC':           ['Australia', 'Japan', 'India', 'South Korea', 'Singapore', 'China', 'New Zealand'],
      'Southeast Asia': ['Singapore', 'Indonesia', 'Philippines', 'Thailand', 'Vietnam', 'Malaysia'],
      // US regional — use just "United States" since Apollo handles country-level well
      'United States, Northeast': ['United States'],
      'United States, Southeast': ['United States'],
      'United States, Midwest':   ['United States'],
      'United States, West':      ['United States'],
      'United States, Southwest': ['United States'],
    };
    const geoTrimmed = geography.trim();
    const expanded = regionExpansion[geoTrimmed];
    filters.person_locations = expanded || [geoTrimmed];
  }

  // Tech stack → also goes into q_organization_keyword_tags (merged with industry tags)
  if (techStack) {
    const tools = typeof techStack === 'string'
      ? techStack.split(',').map(t => t.trim()).filter(Boolean)
      : techStack;
    orgKeywordTags.push(...tools);
  }

  // Set merged keyword tags (industry + tech stack)
  if (orgKeywordTags.length > 0) {
    filters.q_organization_keyword_tags = orgKeywordTags;
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

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

    // Cap at 15 prospects
    const count = Math.min(parseInt(prospectCount) || 10, 15);

    // ── Step 1: Search for people via Apollo ─────────────────────────
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

    // Log first person — dump ALL keys so we can see exactly what Apollo returns
    let debugInfo = {};
    if (rawPeople.length > 0) {
      const sample = rawPeople[0];
      const allKeys = Object.keys(sample);
      console.log(`Apollo search returned ${rawPeople.length} people. First person ALL KEYS: ${JSON.stringify(allKeys)}`);
      console.log(`First person FULL DATA: ${JSON.stringify(sample).slice(0, 2000)}`);
      debugInfo = {
        searchResultKeys: allKeys,
        sampleLinkedin: sample.linkedin_url,
        sampleEmail: sample.email,
        samplePhoneNumbers: sample.phone_numbers,
        responseTopKeys: Object.keys(apolloData),
      };
    } else {
      console.warn('Apollo search returned 0 people');
      debugInfo = { warning: 'no people returned', responseTopKeys: Object.keys(apolloData) };
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
      _debug: debugInfo,
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

    // Extract whatever data the search endpoint already gave us
    const searchEmail = person.email || '';
    const searchLinkedin = person.linkedin_url || '';
    // Apollo search returns phone_numbers as array, or sometimes phone_number
    const searchPhone = extractPhone(person);

    // Log what we got from search (first person only for brevity)
    console.log(`Search data for ${firstName} ${lastName}: email="${searchEmail}", linkedin="${searchLinkedin}", phone="${searchPhone}"`);

    // Call Apollo People Match endpoint to get contact details (1 credit/person)
    const matchResponse = await fetch('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        api_key: apiKey,
        first_name: firstName,
        last_name: lastName,
        organization_name: org.name || person.organization_name || '',
        domain: domain,
        reveal_personal_emails: true,
      }),
    });

    if (matchResponse.ok) {
      const matchData = await matchResponse.json();
      const enrichedPerson = matchData.person;

      // Log raw enrichment result
      if (!enrichedPerson) {
        console.warn(`Enrichment for ${firstName} ${lastName}: no match found (person is null)`);
      } else {
        console.log(`Enrichment for ${firstName} ${lastName}: email="${enrichedPerson.email || ''}", linkedin="${enrichedPerson.linkedin_url || ''}", phones=${JSON.stringify(enrichedPerson.phone_numbers || [])}`);
      }

      // If match returned null/empty person, fall back to search data
      if (!enrichedPerson) {
        return buildProspectFromSearch(person, searchEmail, searchLinkedin, searchPhone);
      }

      // Extract phone from enriched person (phone_numbers is an array)
      const enrichedPhone = extractPhone(enrichedPerson);

      return {
        name: enrichedPerson.name || person.name || `${firstName} ${lastName}`.trim() || 'Unknown',
        title: enrichedPerson.title || person.title || person.headline || '',
        company: (enrichedPerson.organization || {}).name || org.name || person.organization_name || '',
        email: enrichedPerson.email || searchEmail || '',
        phone: enrichedPhone || searchPhone || '',
        linkedinUrl: enrichedPerson.linkedin_url || searchLinkedin || '',
        location: formatLocation(enrichedPerson) || formatLocation(person) || '',
        companyDomain: (enrichedPerson.organization || {}).primary_domain || domain || '',
        companyIndustry: (enrichedPerson.organization || {}).industry || org.industry || '',
        companySize: (enrichedPerson.organization || {}).estimated_num_employees || org.estimated_num_employees || '',
        enrichmentStatus: getEnrichmentStatus({
          email: enrichedPerson.email || searchEmail,
          phone_numbers: enrichedPerson.phone_numbers,
          linkedin_url: enrichedPerson.linkedin_url || searchLinkedin,
          sanitized_phone: enrichedPhone || searchPhone,
        }),
      };
    } else {
      const errText = await matchResponse.text().catch(() => '');
      console.warn(`Apollo enrichment failed for ${firstName} ${lastName}: ${matchResponse.status} ${errText.slice(0, 300)}`);
      return buildProspectFromSearch(person, searchEmail, searchLinkedin, searchPhone);
    }
  } catch (err) {
    console.warn(`Apollo enrichment error for ${person.name || 'unknown'}:`, err.message);
    const searchEmail = person.email || '';
    const searchLinkedin = person.linkedin_url || '';
    const searchPhone = extractPhone(person);
    return buildProspectFromSearch(person, searchEmail, searchLinkedin, searchPhone);
  }
}

// ── Extract phone from Apollo person object ──────────────────────────
// Apollo returns phones in different formats:
//   - phone_numbers: [{ sanitized_number: "+1...", type: "work_direct" }]
//   - phone_number: "+1..." (sometimes)
//   - sanitized_phone: "+1..." (sometimes)
function extractPhone(person) {
  if (!person) return '';
  // Try phone_numbers array first (most common Apollo format)
  if (Array.isArray(person.phone_numbers) && person.phone_numbers.length > 0) {
    return person.phone_numbers[0].sanitized_number || person.phone_numbers[0].number || '';
  }
  // Fallback to flat fields
  return person.phone_number || person.sanitized_phone || '';
}

// ── Build prospect from search-only data ─────────────────────────────
function buildProspectFromSearch(person, searchEmail, searchLinkedin, searchPhone) {
  const org = person.organization || {};
  const hasContact = !!(searchEmail || searchLinkedin);
  return {
    name: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown',
    title: person.title || person.headline || '',
    company: org.name || person.organization_name || '',
    email: searchEmail || '',
    phone: searchPhone || '',
    linkedinUrl: searchLinkedin || '',
    location: formatLocation(person),
    companyDomain: org.primary_domain || org.website_url || '',
    companyIndustry: org.industry || '',
    companySize: org.estimated_num_employees || '',
    enrichmentStatus: hasContact ? 'partial' : 'minimal',
  };
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

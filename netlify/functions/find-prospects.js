// Netlify Function: Find prospects via Apollo People Search + Enrichment
// Step 1: Search (free, no credits) → Step 2: Enrich (1 credit/person for email)
// Step 2b: Request phone reveals via webhook (async, Apollo sends phones to phone-webhook.js)
// Step 3: Hunter.io gap-fill for emails Apollo missed (synchronous, free tier = 25/month)
import crypto from 'crypto';

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

  // Generate session ID for phone webhook tracking
  const sessionId = crypto.randomUUID();

  // Build webhook URL for async phone delivery
  // Use path-based sessionId (not query params) — some APIs strip query strings from webhooks
  const siteUrl = process.env.URL || 'https://tools.mantyl.ai';
  const phoneWebhookUrl = `${siteUrl}/.netlify/functions/phone-webhook/${sessionId}`;
  console.log(`[Phone Webhook] URL: ${phoneWebhookUrl}`);

  try {
    const body = JSON.parse(event.body);
    // Support both new multi-select arrays and legacy single-value strings
    const {
      industries, industry,
      companySegments, companySegment,
      companySizes, companySize,
      geographies, geography,
      jobTitles, techStack, otherCriteria, prospectCount = 10
    } = body;

    // Cap at 20 prospects
    const count = Math.min(parseInt(prospectCount) || 10, 20);

    // ── Step 1: Search for people via Apollo ─────────────────────────
    const apolloFilters = buildApolloFilters({ industries, industry, companySegments, companySegment, companySizes, companySize, jobTitles, geographies, geography, techStack, otherCriteria });

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

    // ── Step 2: Enrich each person via Apollo (ID lookup + match fallback) ─
    // The api_search endpoint returns obfuscated data (no email/phone/linkedin).
    // We use the person ID to fetch full details, then fall back to /people/match.
    let prospects = await enrichProspects(rawPeople, APOLLO_API_KEY, phoneWebhookUrl);

    // Add enrichment stats to debug
    const enrichedCount = prospects.filter(p => p.email || p.linkedinUrl).length;
    debugInfo.enrichmentStats = {
      total: prospects.length,
      withRealEmail: prospects.filter(p => p.email && !p.email.includes('not_unlocked')).length,
      withVerifiedEmail: prospects.filter(p => p.emailStatus === 'verified').length,
      withGuessedEmail: prospects.filter(p => p.emailStatus === 'guessed').length,
      withLinkedin: prospects.filter(p => p.linkedinUrl).length,
      withPhone: prospects.filter(p => p.phone).length,
      enrichedCount,
      waterfallEnabled: true,
      // Show first 3 prospects' full enrichment debug (Step A + Step B results)
      sampleProspects: prospects.slice(0, 3).map(p => ({
        name: p.name,
        email: p.email || '(empty)',
        emailStatus: p.emailStatus || '(none)',
        phone: p.phone || '(empty)',
        linkedin: p.linkedinUrl ? 'yes' : 'no',
        status: p.enrichmentStatus,
        enrichDebug: p._enrichDebug || '(no debug)',
      })),
    };

    // ── Step 3 (Optional): Hunter.io gap-fill for missing emails ────────
    // Hunter.io Email Finder: synchronous API call, free tier = 25 lookups/month.
    // Only runs for prospects where Apollo didn't find an email.
    const HUNTER_API_KEY = process.env.HUNTER_API_KEY;

    if (HUNTER_API_KEY && prospects.length > 0) {
      try {
        const hunterResults = await hunterGapFillEmails(prospects, HUNTER_API_KEY);
        console.log(`[Hunter] Gap-fill complete: ${hunterResults.found}/${hunterResults.attempted} emails found`);
        debugInfo.hunterStats = hunterResults;
      } catch (hunterErr) {
        console.warn('[Hunter] Gap-fill failed:', hunterErr.message);
      }
    }

    // ── Step 4: Email pattern guessing for any remaining gaps ───────────
    // When both Apollo and Hunter fail, construct an email from common
    // corporate patterns. Infers domain from company name if needed.
    // Tries multiple patterns and verifies via Hunter Email Verifier if available.
    // ALWAYS assigns an email — never leaves a prospect without one.
    const stillMissingEmail = prospects.filter(p => !p.email);
    if (stillMissingEmail.length > 0) {
      const patternResults = await guessEmailPatterns(prospects, HUNTER_API_KEY);
      console.log(`[Pattern] Guessed ${patternResults.found}/${patternResults.attempted} emails from patterns`);
      debugInfo.patternStats = patternResults;
    }

    return respond(200, {
      prospects,
      total: prospects.length,
      source: HUNTER_API_KEY ? 'apollo+hunter' : 'apollo',
      sessionId, // For phone polling — frontend uses this to check for async phone data
      _debug: debugInfo,
    });

  } catch (err) {
    console.error('Error finding prospects:', err);
    return respond(500, { error: err.message || 'Failed to find prospects' });
  }
}

// ── Apollo Enrichment — get email, phone, LinkedIn for each person ───
// Batches requests to avoid Apollo rate limits.
// IMPORTANT: Netlify free-tier functions timeout at 10 seconds.
// 20 people × 2 API calls each = 40 calls. Must be fast.
// Batch size 10 = only 2 batches for 20 people (vs 4 batches at size 5).
async function enrichProspects(rawPeople, apiKey, phoneWebhookUrl) {
  const BATCH_SIZE = 10;
  const BATCH_DELAY = 200; // 200ms between batches (was 1000ms — too slow for 20 people)
  const results = [];

  for (let i = 0; i < rawPeople.length; i += BATCH_SIZE) {
    const batch = rawPeople.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(person => enrichOnePerson(person, apiKey, phoneWebhookUrl)));
    results.push(...batchResults);

    // Brief pause between batches (skip after last batch)
    if (i + BATCH_SIZE < rawPeople.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  return results;
}

// Helper: check if an email is a real email (not Apollo's placeholder)
function isRealEmail(email) {
  if (!email) return false;
  // Apollo returns "email_not_unlocked@domain.com" when email exists but hasn't been revealed
  if (email.includes('not_unlocked') || email.includes('email_not_unlocked')) return false;
  // Basic sanity check
  return email.includes('@') && !email.includes('domain.com');
}

async function enrichOnePerson(person, apiKey, phoneWebhookUrl) {
  try {
    const org = person.organization || {};
    const firstName = person.first_name || '';
    const personId = person.id || '';
    const domain = org.primary_domain || org.website_url || '';
    const orgName = org.name || person.organization_name || '';
    const lastName = person.last_name || '';

    console.log(`Enriching ${firstName} (id=${personId}) at ${orgName}...`);

    // ══════════════════════════════════════════════════════════════════════
    // PARALLEL ENRICHMENT (optimized for Netlify 10s timeout):
    //
    // Step A: GET /people/{id} → get linkedin_url + full name (free, no credit)
    // Step B: POST /people/match → reveal email (1 credit)
    //
    // CRITICAL: Steps A and B run IN PARALLEL via Promise.all.
    // Step B uses name+company matching (since linkedin_url isn't available yet).
    // We combine results: email from Step B, linkedin from Step A or B.
    // This cuts per-person time from ~1.5s (sequential) to ~0.8s (parallel).
    // ══════════════════════════════════════════════════════════════════════

    let enrichDebug = { steps: [] };

    // ── Build Step A promise: GET /people/{id} ───────────────────────────
    const stepAPromise = personId ? (async () => {
      try {
        const idResponse = await fetch(`https://api.apollo.io/api/v1/people/${personId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        });
        if (idResponse.ok) {
          const idData = await idResponse.json();
          const p = idData.person || idData;
          enrichDebug.steps.push({
            step: 'A_id_lookup', status: 'ok',
            gotLinkedin: !!p.linkedin_url, gotLastName: !!p.last_name,
            rawEmail: p.email || '(null)', linkedin: p.linkedin_url || '(null)',
          });
          console.log(`Step A for ${firstName}: linkedin="${p.linkedin_url || ''}", lastName="${p.last_name || ''}"`);
          return p;
        } else {
          enrichDebug.steps.push({ step: 'A_id_lookup', status: idResponse.status });
          return null;
        }
      } catch (err) {
        enrichDebug.steps.push({ step: 'A_id_lookup', error: err.message });
        return null;
      }
    })() : Promise.resolve(null);

    // ── Build Step B promise: POST /people/match (name+company) ──────────
    const stepBPromise = (async () => {
      try {
        const matchBody = {
          api_key: apiKey,
          reveal_personal_emails: true,
          reveal_phone_number: true,
          run_waterfall_phone: true,
          // Use name + company matching (can't wait for linkedin from Step A — parallel)
          first_name: firstName,
          organization_name: orgName,
        };
        if (lastName) matchBody.last_name = lastName;
        if (domain) matchBody.domain = domain;

        if (phoneWebhookUrl) {
          matchBody.webhook_url = phoneWebhookUrl;
        }

        const matchResponse = await fetch('https://api.apollo.io/api/v1/people/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify(matchBody),
        });

        if (matchResponse.ok) {
          const matchData = await matchResponse.json();
          const ep = matchData.person;
          const waterfallStatus = matchData.waterfall || null;
          enrichDebug.steps.push({
            step: 'B_match', status: 'ok', hasPerson: !!ep,
            rawEmail: ep?.email || '(null)',
            emailIsReal: ep?.email ? isRealEmail(ep.email) : false,
            emailStatus: ep?.email_status || '(null)',
            matchedBy: 'name+company', waterfallStatus,
          });
          if (ep) {
            console.log(`Step B for ${firstName}: email="${ep.email || ''}", emailStatus="${ep.email_status || ''}", linkedin="${ep.linkedin_url || ''}"`);
          }
          return ep || null;
        } else {
          const errText = await matchResponse.text().catch(() => '');
          enrichDebug.steps.push({ step: 'B_match', status: matchResponse.status, error: errText.slice(0, 200) });
          return null;
        }
      } catch (err) {
        enrichDebug.steps.push({ step: 'B_match', error: err.message });
        return null;
      }
    })();

    // ── Run both steps in parallel ───────────────────────────────────────
    const [idPersonData, matchPerson] = await Promise.all([stepAPromise, stepBPromise]);

    // ── Combine results: email from match, linkedin from either ──────────
    if (matchPerson) {
      const email = isRealEmail(matchPerson.email) ? matchPerson.email : '';
      const phoneData = extractPhone(matchPerson);
      const linkedin = matchPerson.linkedin_url || (idPersonData && idPersonData.linkedin_url) || '';
      const emailStatus = matchPerson.email_status || '';
      const fullName = matchPerson.name || (idPersonData && idPersonData.name) || `${firstName} ${lastName}`.trim() || 'Unknown';

      return {
        apolloId: matchPerson.id || personId,
        name: fullName,
        title: matchPerson.title || person.title || '',
        company: (matchPerson.organization || {}).name || orgName || '',
        email,
        emailStatus,
        phone: phoneData.number,
        phoneType: phoneData.type,
        linkedinUrl: linkedin,
        location: formatLocation(matchPerson) || '',
        companyDomain: (matchPerson.organization || {}).primary_domain || domain || '',
        companyIndustry: (matchPerson.organization || {}).industry || org.industry || '',
        companySize: (matchPerson.organization || {}).estimated_num_employees || org.estimated_num_employees || '',
        enrichmentStatus: email ? 'enriched' : (linkedin ? 'partial' : 'minimal'),
        _enrichDebug: enrichDebug,
      };
    }

    // ── Fallback: return ID lookup data if available, else search data ──
    if (idPersonData) {
      const linkedin = idPersonData.linkedin_url || '';
      return {
        name: idPersonData.name || `${firstName} ${lastName}`.trim() || 'Unknown',
        title: idPersonData.title || person.title || '',
        company: (idPersonData.organization || {}).name || orgName || '',
        email: '',
        phone: '',
        linkedinUrl: linkedin,
        location: formatLocation(idPersonData) || '',
        companyDomain: (idPersonData.organization || {}).primary_domain || domain || '',
        companyIndustry: (idPersonData.organization || {}).industry || org.industry || '',
        companySize: (idPersonData.organization || {}).estimated_num_employees || org.estimated_num_employees || '',
        enrichmentStatus: linkedin ? 'partial' : 'minimal',
        _enrichDebug: enrichDebug,
      };
    }

    console.warn(`All enrichment failed for ${firstName} — returning search-only data`);
    return {
      name: person.name || firstName || 'Unknown',
      title: person.title || '',
      company: orgName || '',
      email: '',
      phone: '',
      linkedinUrl: '',
      location: '',
      companyDomain: domain || '',
      companyIndustry: org.industry || '',
      companySize: org.estimated_num_employees || '',
      enrichmentStatus: 'minimal',
      _enrichDebug: enrichDebug,
    };
  } catch (err) {
    console.warn(`Enrichment error for ${person.first_name || 'unknown'}:`, err.message);
    return {
      name: person.first_name || 'Unknown',
      title: person.title || '',
      company: (person.organization || {}).name || '',
      email: '',
      phone: '',
      linkedinUrl: '',
      location: '',
      companyDomain: '',
      companyIndustry: '',
      companySize: '',
      enrichmentStatus: 'minimal',
    };
  }
}

// ── Extract phone from Apollo person object ──────────────────────────
// Apollo returns phones in different formats:
//   - phone_numbers: [{ sanitized_number: "+1...", type: "work_direct"|"mobile" }]
//   - phone_number: "+1..." (sometimes)
//   - sanitized_phone: "+1..." (sometimes)
// Returns { number, type } where type is "work_direct", "mobile", or ""
function extractPhone(person) {
  if (!person) return { number: '', type: '' };
  // Try phone_numbers array first (most common Apollo format)
  if (Array.isArray(person.phone_numbers) && person.phone_numbers.length > 0) {
    const p = person.phone_numbers[0];
    return {
      number: p.sanitized_number || p.number || p.raw_number || '',
      type: p.type || '', // "work_direct" or "mobile"
    };
  }
  // Fallback to flat fields
  const num = person.phone_number || person.sanitized_phone || '';
  return { number: num, type: '' };
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
function buildApolloFilters({ industries, industry, companySegments, companySegment, companySizes, companySize, jobTitles, geographies, geography, techStack, otherCriteria }) {
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

  // Industries → q_organization_keyword_tags (ARRAY of company-level keyword tags)
  // Supports both multi-select array (new) and single string (legacy)
  const industryList = Array.isArray(industries) && industries.length > 0
    ? industries
    : (industry && industry.trim() ? [industry.trim()] : []);

  if (industryList.length > 0) {
    const industryTags = [];
    for (const ind of industryList) {
      if (ind.toLowerCase() === 'other') continue;
      const tags = ind
        .split(/\s*[\/&–—]\s*/)
        .map(tag => tag.trim())
        .filter(tag => tag.length > 1);
      industryTags.push(...tags);
    }
    if (industryTags.length > 0) {
      filters.q_organization_keyword_tags = [...new Set(industryTags)];
    }
  }

  // Company sizes + segments → organization_num_employees_ranges
  // Apollo's official API expects HYPHENATED predefined ranges: "1-10", "11-20", "51-100", "10001+"
  // Segments expand to multiple predefined ranges (e.g. SMB = 1-10 through 101-200)
  const sizeMap = {
    '1-10':        '1-10',
    '11-20':       '11-20',
    '21-50':       '21-50',
    '51-100':      '51-100',
    '101-200':     '101-200',
    '201-500':     '201-500',
    '501-1,000':   '501-1000',
    '1,001-2,000': '1001-2000',
    '2,001-5,000': '2001-5000',
    '5,001-10,000':'5001-10000',
    '10,001+':     '10001+',
  };
  // Segments expand to ALL matching predefined Apollo ranges
  const segmentRanges = {
    'SMB':        ['1-10', '11-20', '21-50', '51-100', '101-200'],
    'Midmarket':  ['201-500', '501-1000'],
    'Enterprise': ['1001-2000', '2001-5000', '5001-10000', '10001+'],
  };

  const employeeRanges = new Set();

  // Multi-select sizes (new)
  const sizeList = Array.isArray(companySizes) && companySizes.length > 0
    ? companySizes
    : (companySize ? [companySize] : []);
  for (const s of sizeList) {
    if (sizeMap[s]) employeeRanges.add(sizeMap[s]);
  }

  // Multi-select segments — each segment expands to multiple predefined ranges
  const segList = Array.isArray(companySegments) && companySegments.length > 0
    ? companySegments
    : (companySegment ? [companySegment] : []);
  for (const seg of segList) {
    const ranges = segmentRanges[seg];
    if (ranges) ranges.forEach(r => employeeRanges.add(r));
  }

  if (employeeRanges.size > 0) {
    filters.organization_num_employees_ranges = [...employeeRanges];
  }

  // Geography → person_locations
  // Supports both multi-select array (new) and single string (legacy)
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
    'United States, Northeast': ['United States'],
    'United States, Southeast': ['United States'],
    'United States, Midwest':   ['United States'],
    'United States, West':      ['United States'],
    'United States, Southwest': ['United States'],
  };

  const geoList = Array.isArray(geographies) && geographies.length > 0
    ? geographies
    : (geography ? [geography.trim()] : []);

  if (geoList.length > 0) {
    const allLocations = new Set();
    for (const geo of geoList) {
      const expanded = regionExpansion[geo.trim()];
      if (expanded) {
        expanded.forEach(loc => allLocations.add(loc));
      } else {
        allLocations.add(geo.trim());
      }
    }
    if (allLocations.size > 0) {
      filters.person_locations = [...allLocations];
    }
  }

  // Tech stack → BOTH technology_names AND q_organization_keyword_tags
  // technology_names: Apollo's curated technology database — precise matching for known tools
  //   (e.g. "Salesforce", "HubSpot", "AWS"). Best for well-known SaaS/tools.
  // q_organization_keyword_tags: Broader keyword match — catches tools not in Apollo's tech DB.
  // Using both ensures maximum coverage: exact tech matches + keyword fallback.
  // Supports: multi-select array (new), comma-separated string (legacy)
  if (techStack) {
    const tools = Array.isArray(techStack)
      ? techStack.filter(Boolean)
      : (typeof techStack === 'string' ? techStack.split(',').map(t => t.trim()).filter(Boolean) : []);
    if (tools.length > 0) {
      filters.technology_names = tools;
      // Also add to org keyword tags as fallback for tools not in Apollo's tech database
      filters.q_organization_keyword_tags = [
        ...(filters.q_organization_keyword_tags || []),
        ...tools,
      ];
    }
  }

  // Other qualifying criteria → structured Apollo API parameters
  // Supports: multi-select array of coded values (new), free-text string (legacy)
  // Coded values map to specific Apollo API filter parameters:
  //   - c_suite, founder, owner, vp, head, director, manager, senior, entry → person_seniorities
  //   - dept_* → person_departments (strip "dept_" prefix)
  //   - rev_* → organization_revenue_range (mapped to Apollo's comma-separated ranges)
  //   - fund_* → q_organization_keyword_tags (funding stage keywords)
  if (otherCriteria) {
    if (Array.isArray(otherCriteria) && otherCriteria.length > 0) {
      const seniorities = [];
      const departments = [];
      const revenueRanges = [];
      const fundingKeywords = [];

      const seniorityValues = new Set(['c_suite', 'founder', 'owner', 'vp', 'head', 'director', 'manager', 'senior', 'entry']);

      const revenueMap = {
        'rev_0_1M':       '0,1000000',
        'rev_1M_10M':     '1000000,10000000',
        'rev_10M_50M':    '10000000,50000000',
        'rev_50M_100M':   '50000000,100000000',
        'rev_100M_500M':  '100000000,500000000',
        'rev_500M_1B':    '500000000,1000000000',
        'rev_1B_plus':    '1000000000,',
      };

      const fundingMap = {
        'fund_seed':           'seed funding',
        'fund_series_a':       'series a',
        'fund_series_b':       'series b',
        'fund_series_c':       'series c',
        'fund_series_d':       'series d',
        'fund_ipo':            'ipo public',
        'fund_private_equity': 'private equity',
        'fund_bootstrapped':   'bootstrapped',
      };

      for (const val of otherCriteria) {
        if (seniorityValues.has(val)) {
          seniorities.push(val);
        } else if (val.startsWith('dept_')) {
          departments.push(val.replace('dept_', ''));
        } else if (val.startsWith('rev_') && revenueMap[val]) {
          revenueRanges.push(revenueMap[val]);
        } else if (val.startsWith('fund_') && fundingMap[val]) {
          fundingKeywords.push(fundingMap[val]);
        }
      }

      if (seniorities.length > 0) filters.person_seniorities = seniorities;
      if (departments.length > 0) filters.person_departments = departments;
      if (revenueRanges.length > 0) filters.organization_revenue_range = revenueRanges;
      if (fundingKeywords.length > 0) {
        filters.q_organization_keyword_tags = [
          ...(filters.q_organization_keyword_tags || []),
          ...fundingKeywords,
        ];
      }
    } else if (typeof otherCriteria === 'string' && otherCriteria.trim()) {
      // Legacy: free-text string → q_keywords
      filters.q_keywords = otherCriteria.trim();
    }
  }

  console.log('Apollo filters:', JSON.stringify(filters, null, 2));
  return filters;
}

// ── Hunter.io gap-fill for missing emails ────────────────────────────
// Uses Hunter.io Email Finder API (free tier: 25 lookups/month).
// Only looks up emails for prospects where Apollo returned nothing.
// Synchronous — results come back immediately, no polling needed.
//
// API: GET https://api.hunter.io/v2/email-finder?domain=X&first_name=Y&last_name=Z&api_key=K
// Response: { data: { email: "found@email.com", score: 91, ... } }
async function hunterGapFillEmails(prospects, hunterApiKey) {
  const needsEmail = prospects.filter(p => !p.email && p.companyDomain);

  if (needsEmail.length === 0) {
    console.log('[Hunter] All prospects have emails — skipping Hunter');
    return { attempted: 0, found: 0 };
  }

  // Cap Hunter lookups to stay within Netlify Pro function timeout (26s).
  // Hunter calls are sequential — 10 calls ≈ 8 seconds max.
  const MAX_HUNTER_LOOKUPS = 10;
  const toProcess = needsEmail.slice(0, MAX_HUNTER_LOOKUPS);

  console.log(`[Hunter] ${needsEmail.length}/${prospects.length} prospects missing email — querying Hunter.io (capped at ${toProcess.length})`);

  let found = 0;
  let attempted = 0;

  // Process one at a time to respect Hunter's rate limits (free tier)
  for (const prospect of toProcess) {
    attempted++;
    try {
      const nameParts = (prospect.name || '').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      if (!firstName || !prospect.companyDomain) {
        console.log(`[Hunter] Skipping ${prospect.name}: missing name or domain`);
        continue;
      }

      const params = new URLSearchParams({
        domain: prospect.companyDomain,
        first_name: firstName,
        last_name: lastName,
        api_key: hunterApiKey,
      });

      const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`);

      if (res.status === 429) {
        console.warn('[Hunter] Rate limit hit — stopping gap-fill');
        break;
      }

      if (res.status === 402) {
        console.warn('[Hunter] Monthly quota exhausted — stopping gap-fill');
        break;
      }

      if (!res.ok) {
        console.warn(`[Hunter] API error for ${prospect.name}: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const hunterEmail = data?.data?.email;
      const score = data?.data?.score || 0;

      if (hunterEmail && hunterEmail.includes('@') && score >= 50) {
        prospect.email = hunterEmail;
        prospect.emailStatus = score >= 80 ? 'hunter_verified' : 'hunter_guessed';
        prospect.emailSource = 'hunter';
        prospect.enrichmentStatus = prospect.linkedinUrl ? 'enriched' : 'partial';
        found++;
        console.log(`[Hunter] Found email for ${prospect.name}: ${hunterEmail} (score: ${score})`);
      } else {
        console.log(`[Hunter] No confident email for ${prospect.name} (score: ${score})`);
      }

      // Brief pause between calls (be nice to free tier)
      await new Promise(r => setTimeout(r, 150));

    } catch (err) {
      console.warn(`[Hunter] Error for ${prospect.name}:`, err.message);
    }
  }

  return { attempted, found };
}

// ── Email pattern guessing (Step 4 fallback) ─────────────────────────
// When Apollo and Hunter both fail, construct emails from common patterns.
// Strategy:
//   1. Infer domain from company name if companyDomain is missing
//   2. Look at emails we DID find for the same domain → infer the pattern
//   3. Try multiple patterns until one verifies, or use best guess
//
// Common corporate email patterns (ordered by frequency):
//   first.last@domain.com  (~55% of companies)
//   flast@domain.com       (~12%)
//   first@domain.com       (~15%)
//   firstl@domain.com      (~8%)
//   first_last@domain.com  (~5%)
async function guessEmailPatterns(prospects, hunterApiKey) {
  // First: infer missing domains from company name or LinkedIn URL
  for (const p of prospects) {
    if (!p.companyDomain && p.company) {
      p.companyDomain = inferDomainFromCompany(p.company, p.linkedinUrl);
      if (p.companyDomain) {
        console.log(`[Pattern] Inferred domain for ${p.company}: ${p.companyDomain}`);
      }
    }
  }

  const needsEmail = prospects.filter(p => !p.email && p.companyDomain);
  if (needsEmail.length === 0) return { attempted: 0, found: 0 };

  // Learn patterns from emails we already have (same domain)
  const domainPatterns = {};
  for (const p of prospects) {
    if (!p.email || !p.companyDomain) continue;
    const pattern = detectPattern(p.email, p.name, p.companyDomain);
    if (pattern) {
      domainPatterns[p.companyDomain.toLowerCase()] = pattern;
    }
  }

  let found = 0;
  let attempted = 0;
  let verifierAvailable = !!hunterApiKey;
  // Budget: max 15 Hunter verify API calls total to stay within Netlify Pro timeout (26s).
  // For <=5 prospects: try multiple patterns per person (up to 5 each).
  // For >5 prospects: try only the top 2 patterns per person.
  const MAX_VERIFY_CALLS = 15;
  let verifyCallsUsed = 0;
  const patternsPerProspect = needsEmail.length <= 5 ? 5 : 2;

  for (const prospect of needsEmail) {
    attempted++;
    const domain = prospect.companyDomain.toLowerCase();
    const nameParts = (prospect.name || '').split(' ');
    const firstName = (nameParts[0] || '').toLowerCase().replace(/[^a-z]/g, '');
    const lastName = (nameParts.slice(1).join(' ') || '').toLowerCase().replace(/[^a-z]/g, '');

    if (!firstName || !lastName || !domain) continue;

    // Build candidate emails: known pattern first, then try all common patterns
    const knownPattern = domainPatterns[domain];
    const candidates = [];

    // If we know the pattern for this domain, try that first
    if (knownPattern) {
      candidates.push({ email: buildEmail(knownPattern, firstName, lastName, domain), pattern: knownPattern });
    }

    // Add all common patterns (skip the known one to avoid duplicates)
    const allPatterns = ['first.last', 'flast', 'first', 'firstl', 'first_last'];
    for (const pat of allPatterns) {
      if (pat !== knownPattern) {
        candidates.push({ email: buildEmail(pat, firstName, lastName, domain), pattern: pat });
      }
    }

    // Try to verify each candidate with Hunter (limited by budget)
    let bestEmail = candidates[0].email; // Default to first candidate
    let bestPattern = candidates[0].pattern;
    let verified = false;

    // Only try up to patternsPerProspect candidates, and respect global verify budget
    const candidatesToTry = candidates.slice(0, patternsPerProspect);

    if (verifierAvailable && verifyCallsUsed < MAX_VERIFY_CALLS) {
      for (const candidate of candidatesToTry) {
        if (verifyCallsUsed >= MAX_VERIFY_CALLS) {
          console.log(`[Pattern] Verify budget exhausted (${MAX_VERIFY_CALLS} calls) — using best guess for remaining`);
          break;
        }

        try {
          verifyCallsUsed++;
          const params = new URLSearchParams({
            email: candidate.email,
            api_key: hunterApiKey,
          });
          const res = await fetch(`https://api.hunter.io/v2/email-verifier?${params}`);

          if (res.status === 429 || res.status === 402) {
            console.warn('[Pattern] Hunter verifier quota hit — using best guess for remaining');
            verifierAvailable = false;
            break;
          }

          if (res.ok) {
            const data = await res.json();
            const status = data?.data?.status;
            const score = data?.data?.score || 0;

            if (status === 'valid') {
              bestEmail = candidate.email;
              bestPattern = candidate.pattern;
              verified = true;
              console.log(`[Pattern] Verified ${candidate.email} (pattern: ${candidate.pattern}, score: ${score})`);
              break; // Found a valid one, stop trying
            } else if (status === 'accept_all') {
              // Server accepts anything — use this but keep trying for a better match
              bestEmail = candidate.email;
              bestPattern = candidate.pattern;
              console.log(`[Pattern] ${candidate.email} is accept_all (score: ${score})`);
              break; // accept_all means the domain accepts any address, no point trying more
            }
            // "invalid" or "unknown" — try next pattern
            console.log(`[Pattern] ${candidate.email} is ${status} — trying next pattern`);
          }

          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          console.warn(`[Pattern] Verify error for ${candidate.email}:`, err.message);
        }
      }
    }

    // ALWAYS assign an email — never leave a prospect without one
    prospect.email = bestEmail;
    prospect.emailStatus = verified ? 'verified' : 'pattern_guessed';
    prospect.emailSource = 'pattern';
    prospect.enrichmentStatus = prospect.linkedinUrl ? 'enriched' : 'partial';
    found++;
    console.log(`[Pattern] ${verified ? 'Verified' : 'Guessed'} email for ${prospect.name}: ${bestEmail} (pattern: ${bestPattern})`);
  }

  return { attempted, found };
}

// Build email from pattern + name parts
function buildEmail(pattern, firstName, lastName, domain) {
  switch (pattern) {
    case 'first.last': return `${firstName}.${lastName}@${domain}`;
    case 'flast': return `${firstName[0]}${lastName}@${domain}`;
    case 'first': return `${firstName}@${domain}`;
    case 'firstl': return `${firstName}${lastName[0]}@${domain}`;
    case 'first_last': return `${firstName}_${lastName}@${domain}`;
    case 'last.first': return `${lastName}.${firstName}@${domain}`;
    default: return `${firstName}.${lastName}@${domain}`;
  }
}

// Infer company domain from company name when Apollo didn't provide one
function inferDomainFromCompany(companyName, linkedinUrl) {
  if (!companyName) return '';

  // Try to extract domain from LinkedIn company URL if available
  // e.g., linkedin.com/company/ncc-group → nccgroup.com
  if (linkedinUrl && linkedinUrl.includes('linkedin.com/company/')) {
    const match = linkedinUrl.match(/linkedin\.com\/company\/([^/?]+)/);
    if (match) {
      const slug = match[1].replace(/-/g, '');
      return `${slug}.com`;
    }
  }

  // Common company name → domain mappings
  const cleaned = companyName
    .toLowerCase()
    .replace(/\s*(inc\.?|llc|ltd\.?|corp\.?|co\.?|group|plc|gmbh|ag|sa|services?|solutions?|technologies?|consulting)\s*/gi, '')
    .trim()
    .replace(/[^a-z0-9]/g, ''); // Remove spaces, special chars

  if (cleaned) {
    return `${cleaned}.com`;
  }

  return '';
}

// Detect which email pattern a company uses based on a known email + name
function detectPattern(email, name, domain) {
  if (!email || !name || !domain) return null;
  const local = email.split('@')[0].toLowerCase();
  const nameParts = (name || '').split(' ');
  const first = (nameParts[0] || '').toLowerCase().replace(/[^a-z]/g, '');
  const last = (nameParts.slice(1).join(' ') || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!first || !last) return null;

  if (local === `${first}.${last}`) return 'first.last';
  if (local === `${first[0]}${last}`) return 'flast';
  if (local === first) return 'first';
  if (local === `${first}${last[0]}`) return 'firstl';
  if (local === `${first}_${last}`) return 'first_last';
  if (local === `${last}.${first}`) return 'last.first';
  return null;
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

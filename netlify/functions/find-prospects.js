// Netlify Function: Find prospects via Apollo People Search + Enrichment
// Step 1: Search (free, no credits) → Step 2: Enrich (1 credit/person for email + phone)
// Step 3: Hunter.io gap-fill for emails Apollo missed (synchronous, free tier = 25/month)

export async function handler(event) {
  const FUNCTION_START = Date.now();
  // Netlify Pro timeout = 26s. We stop all work at 21s to leave comfortable buffer
  // for response serialization + network overhead. Previous value of 24s caused
  // 26.9s total runs because Hunter/Pattern checks overshoot their sub-deadlines.
  const HARD_DEADLINE_MS = 21000;

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
    // Support both new multi-select arrays and legacy single-value strings
    const {
      industries, industry,
      companySegments, companySegment,
      companySizes, companySize,
      geographies, geography,
      jobTitles, techStack, otherCriteria, prospectCount = 20
    } = body;

    // Cap at 20 prospects per run
    const count = Math.min(parseInt(prospectCount) || 20, 20);

    // ── Step 1: Search for people via Apollo ─────────────────────────
    // Over-fetch 3x the requested count so we can prioritize prospects
    // that have has_direct_phone=true (Apollo has their phone number).
    // Then we enrich only the top N prospects.
    const overFetchCount = Math.min(count * 3, 100); // Apollo max per_page = 100
    const apolloFilters = buildApolloFilters({ industries, industry, companySegments, companySegment, companySizes, companySize, jobTitles, geographies, geography, techStack, otherCriteria });

    const apolloResponse = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': APOLLO_API_KEY,
      },
      body: JSON.stringify({
        per_page: overFetchCount,
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

    let rawPeople = apolloData.people || apolloData.contacts || [];
    if (!Array.isArray(rawPeople)) {
      console.error('Apollo people/contacts is not an array:', typeof rawPeople);
      throw new Error('Apollo API returned an unexpected data structure');
    }

    // ── Prioritize prospects with phone data ──────────────────────────
    // Apollo search results include has_direct_phone — can be boolean true
    // OR string "Yes" depending on Apollo's response format.
    const hasPhone = (p) => p.has_direct_phone === true || p.has_direct_phone === 'Yes';
    const withPhone = rawPeople.filter(hasPhone);
    const withoutPhone = rawPeople.filter(p => !hasPhone(p));
    const sorted = [...withPhone, ...withoutPhone];
    rawPeople = sorted.slice(0, count);

    const phonePriorityMsg = `[Phone Priority] ${withPhone.length}/${apolloData.people?.length || 0} search results have has_direct_phone=true. Selected ${Math.min(withPhone.length, count)} with phone + ${Math.max(0, count - withPhone.length)} without.`;
    console.log(phonePriorityMsg);

    // Log first person — dump ALL keys so we can see exactly what Apollo returns
    let debugInfo = {
      phonePriority: {
        totalSearchResults: apolloData.people?.length || 0,
        withDirectPhone: withPhone.length,
        selectedWithPhone: Math.min(withPhone.length, count),
        selectedWithoutPhone: Math.max(0, count - withPhone.length),
        overFetchRequested: overFetchCount,
      },
    };
    if (rawPeople.length > 0) {
      const sample = rawPeople[0];
      const allKeys = Object.keys(sample);
      console.log(`Apollo search returned ${rawPeople.length} people. First person ALL KEYS: ${JSON.stringify(allKeys)}`);
      console.log(`First person FULL DATA: ${JSON.stringify(sample).slice(0, 2000)}`);
      debugInfo.searchResultKeys = allKeys;
      debugInfo.sampleLinkedin = sample.linkedin_url;
      debugInfo.sampleEmail = sample.email;
      debugInfo.samplePhoneNumbers = sample.phone_numbers;
      debugInfo.sampleHasDirectPhone = sample.has_direct_phone;
      debugInfo.responseTopKeys = Object.keys(apolloData);
    } else {
      console.warn('Apollo search returned 0 people');
      debugInfo.warning = 'no people returned';
      debugInfo.responseTopKeys = Object.keys(apolloData);
    }

    // ── Step 2: Enrich each person via Apollo (ID lookup + match fallback) ─
    // The api_search endpoint returns obfuscated data (no email/phone/linkedin).
    // We use the person ID to fetch full details, then fall back to /people/match.
    const enrichStart = Date.now();
    let prospects = await enrichProspects(rawPeople, APOLLO_API_KEY);
    console.log(`[Timing] Enrichment took ${Date.now() - enrichStart}ms for ${prospects.length} prospects`);

    // Add enrichment stats to debug
    const enrichedCount = prospects.filter(p => p.email || p.linkedinUrl).length;
    // Phone numbers are not fetched (gated feature — users book a call to access).
    const phoneDiagnosis = 'GATED: Phone numbers disabled to conserve credits. Shown as gated feature in UI.';

    debugInfo.enrichmentStats = {
      total: prospects.length,
      withRealEmail: prospects.filter(p => p.email && !p.email.includes('not_unlocked')).length,
      withVerifiedEmail: prospects.filter(p => p.emailStatus === 'verified').length,
      withGuessedEmail: prospects.filter(p => p.emailStatus === 'guessed').length,
      withLinkedin: prospects.filter(p => p.linkedinUrl).length,
      withPhone: 0,
      enrichedCount,
      waterfallEnabled: false,
      phoneDiagnosis: phoneDiagnosis || 'OK',
      // Show first 3 prospects' full enrichment debug (Step A + Step B + Step C results)
      sampleProspects: prospects.slice(0, 3).map(p => ({
        name: p.name,
        email: p.email || '(empty)',
        emailStatus: p.emailStatus || '(none)',
        phone: '(gated)',
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
      const hunterTimeLeft = HARD_DEADLINE_MS - (Date.now() - FUNCTION_START);
      if (hunterTimeLeft > 4000) { // Only run Hunter if we have at least 4s left (need room for pattern guessing)
        try {
          const hunterResults = await hunterGapFillEmails(prospects, HUNTER_API_KEY, FUNCTION_START, HARD_DEADLINE_MS);
          console.log(`[Hunter] Gap-fill complete: ${hunterResults.found}/${hunterResults.attempted} emails found`);
          debugInfo.hunterStats = hunterResults;
        } catch (hunterErr) {
          console.warn('[Hunter] Gap-fill failed:', hunterErr.message);
        }
      } else {
        console.warn(`[Hunter] Skipped — only ${Math.round(hunterTimeLeft / 1000)}s left (need >4s)`);
        debugInfo.hunterStats = { skipped: true, reason: 'time_budget_exhausted' };
      }
    }

    // ── Step 4: Email pattern guessing for any remaining gaps ───────────
    // When both Apollo and Hunter fail, construct an email from common
    // corporate patterns. Infers domain from company name if needed.
    // Tries multiple patterns and verifies via Hunter Email Verifier if available.
    // ALWAYS assigns an email — never leaves a prospect without one.
    const stillMissingEmail = prospects.filter(p => !p.email);
    if (stillMissingEmail.length > 0) {
      const patternTimeLeft = HARD_DEADLINE_MS - (Date.now() - FUNCTION_START);
      const patternResults = await guessEmailPatterns(prospects, HUNTER_API_KEY, FUNCTION_START, HARD_DEADLINE_MS);
      console.log(`[Pattern] Guessed ${patternResults.found}/${patternResults.attempted} emails from patterns (${Math.round(patternTimeLeft / 1000)}s budget)`);
      debugInfo.patternStats = patternResults;
    }

    const totalElapsed = Date.now() - FUNCTION_START;
    console.log(`[Timing] Total function time: ${totalElapsed}ms (${Math.round(totalElapsed / 1000)}s / 26s limit, work deadline: ${HARD_DEADLINE_MS}ms)`);
    debugInfo.timing = { totalMs: totalElapsed, limitMs: 26000, workDeadlineMs: HARD_DEADLINE_MS };

    return respond(200, {
      prospects,
      total: prospects.length,
      source: HUNTER_API_KEY ? 'apollo+hunter' : 'apollo',
      _debug: debugInfo,
    });

  } catch (err) {
    const totalElapsed = Date.now() - FUNCTION_START;
    console.error(`Error finding prospects (after ${totalElapsed}ms):`, err);
    return respond(500, { error: err.message || 'Failed to find prospects' });
  }
}

// ── Apollo Enrichment — get email, phone, LinkedIn for each person ───
// Batches requests (10 at a time) to avoid Apollo rate limits.
// Netlify Pro timeout = 26s. With sequential A→B enrichment per person,
// 20 people in 2 batches ≈ 3s enrichment + Hunter/Pattern ≈ 15-20s total.
async function enrichProspects(rawPeople, apiKey) {
  const BATCH_SIZE = 10;
  const BATCH_DELAY = 200; // 200ms between batches (was 1000ms — too slow for 20 people)
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

// Helper: check if an email is a real email (not Apollo's placeholder)
function isRealEmail(email) {
  if (!email) return false;
  // Apollo returns "email_not_unlocked@domain.com" when email exists but hasn't been revealed
  if (email.includes('not_unlocked') || email.includes('email_not_unlocked')) return false;
  // Basic sanity check
  return email.includes('@') && !email.includes('domain.com');
}

async function enrichOnePerson(person, apiKey) {
  try {
    const org = person.organization || {};
    const firstName = person.first_name || '';
    const personId = person.id || '';
    const domain = org.primary_domain || org.website_url || '';
    const orgName = org.name || person.organization_name || '';

    console.log(`Enriching ${firstName} (id=${personId}) at ${orgName}...`);

    // ══════════════════════════════════════════════════════════════════════
    // SEQUENTIAL ENRICHMENT (Netlify Pro = 26s timeout, plenty of room):
    //
    // Step A: GET /people/{id} → get linkedin_url + full name (free, no credit)
    // Step B: POST /people/match with linkedin_url → reveal email (1 credit)
    //
    // IMPORTANT: Steps run SEQUENTIALLY because Step B needs linkedin_url
    // from Step A. LinkedIn URL is Apollo's strongest match identifier —
    // without it, /people/match often returns null (especially when search
    // results only have first names). With batch size 10, this takes ~3s
    // for 20 people, well within Pro's 26s limit.
    // ══════════════════════════════════════════════════════════════════════

    let linkedinUrl = '';
    let fullName = '';
    let lastName = '';
    let idPersonData = null;
    let stepAPhone = { number: '', type: '' }; // Phone from Step A (fallback if Step B has none)
    let enrichDebug = { steps: [] };

    // ── Step A: GET /people/{id} to get linkedin_url and full name ──────
    if (personId) {
      try {
        const idResponse = await fetch(`https://api.apollo.io/api/v1/people/${personId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
        });

        if (idResponse.ok) {
          const idData = await idResponse.json();
          idPersonData = idData.person || idData;

          linkedinUrl = idPersonData.linkedin_url || '';
          fullName = idPersonData.name || '';
          lastName = idPersonData.last_name || '';

          // Extract phone from Step A — used as fallback if Step B has none
          stepAPhone = extractPhone(idPersonData);

          enrichDebug.steps.push({
            step: 'A_id_lookup',
            status: 'ok',
            gotLinkedin: !!linkedinUrl,
            gotLastName: !!lastName,
            rawEmail: idPersonData.email || '(null)',
            linkedin: linkedinUrl || '(null)',
            phone: stepAPhone.number || '(null)',
            phoneType: stepAPhone.type || '(null)',
            phoneFields: {
              phone_numbers: idPersonData.phone_numbers?.length || 0,
              phone_number: idPersonData.phone_number || '(null)',
              sanitized_phone: idPersonData.sanitized_phone || '(null)',
              direct_phone: idPersonData.direct_phone || '(null)',
              corporate_phone: idPersonData.corporate_phone || '(null)',
            },
          });

          console.log(`Step A for ${firstName}: linkedin="${linkedinUrl}", lastName="${lastName}", rawEmail="${idPersonData.email || ''}", phone="${stepAPhone.number}" (${stepAPhone.type})`);
        } else {
          enrichDebug.steps.push({ step: 'A_id_lookup', status: idResponse.status });
          console.warn(`Step A failed for ${firstName}: ${idResponse.status}`);
        }
      } catch (idErr) {
        enrichDebug.steps.push({ step: 'A_id_lookup', error: idErr.message });
        console.warn(`Step A error for ${firstName}:`, idErr.message);
      }
    }

    // ── Step B: POST /people/match with linkedin_url to reveal email + phone ──
    // linkedin_url is the strongest identifier — triggers proper enrichment.
    // Phone numbers come directly from Apollo's database (no async waterfall).
    try {
      const matchBody = {
        api_key: apiKey,
        reveal_personal_emails: true,
      };

      // Use linkedin_url as primary identifier (strongest match signal)
      if (linkedinUrl) {
        matchBody.linkedin_url = linkedinUrl;
      } else {
        // Fallback: use name + company
        matchBody.first_name = firstName;
        if (lastName) matchBody.last_name = lastName;
        matchBody.organization_name = orgName;
        if (domain) matchBody.domain = domain;
      }

      const matchResponse = await fetch('https://api.apollo.io/api/v1/people/match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(matchBody),
      });

      if (matchResponse.ok) {
        const matchData = await matchResponse.json();
        const ep = matchData.person;

        enrichDebug.steps.push({
          step: 'B_match',
          status: 'ok',
          hasPerson: !!ep,
          rawEmail: ep?.email || '(null)',
          emailIsReal: ep?.email ? isRealEmail(ep.email) : false,
          emailStatus: ep?.email_status || '(null)',
          matchedBy: linkedinUrl ? 'linkedin_url' : 'name+company',
          personKeys: ep ? Object.keys(ep) : [],
          phoneFieldsInResponse: ep ? Object.keys(ep).filter(k => k.toLowerCase().includes('phone')) : [],
        });

        if (ep) {
          const email = isRealEmail(ep.email) ? ep.email : '';
          const linkedin = ep.linkedin_url || linkedinUrl || '';
          const emailStatus = ep.email_status || '';
          const resolvedPersonId = ep.id || personId;

          console.log(`Step B for ${firstName}: email="${email}", emailStatus="${emailStatus}"`);

          return {
            apolloId: resolvedPersonId,
            name: ep.name || fullName || `${ep.first_name || firstName} ${ep.last_name || lastName}`.trim() || 'Unknown',
            title: ep.title || person.title || '',
            company: (ep.organization || {}).name || orgName || '',
            email: email,
            emailStatus: emailStatus,
            linkedinUrl: linkedin,
            location: formatLocation(ep) || '',
            companyDomain: (ep.organization || {}).primary_domain || domain || '',
            companyIndustry: (ep.organization || {}).industry || org.industry || '',
            companySize: (ep.organization || {}).estimated_num_employees || org.estimated_num_employees || '',
            enrichmentStatus: email ? 'enriched' : (linkedin ? 'partial' : 'minimal'),
            _enrichDebug: enrichDebug,
          };
        } else {
          console.warn(`Step B for ${firstName}: no person returned`);
        }
      } else {
        const errText = await matchResponse.text().catch(() => '');
        enrichDebug.steps.push({ step: 'B_match', status: matchResponse.status, error: errText.slice(0, 200) });
        console.warn(`Step B failed for ${firstName}: ${matchResponse.status} ${errText.slice(0, 200)}`);
      }
    } catch (matchErr) {
      enrichDebug.steps.push({ step: 'B_match', error: matchErr.message });
      console.warn(`Step B error for ${firstName}:`, matchErr.message);
    }

    // ── Fallback: return ID lookup data if available, else search data ──
    if (idPersonData) {
      const linkedin = idPersonData.linkedin_url || '';
      return {
        name: idPersonData.name || fullName || firstName || 'Unknown',
        title: idPersonData.title || person.title || '',
        company: (idPersonData.organization || {}).name || orgName || '',
        email: '',
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
// Apollo returns phones in many different formats depending on endpoint:
//   - phone_numbers: [{ sanitized_number: "+1...", type: "work_direct"|"mobile" }]
//   - phone_number: "+1..." (flat field)
//   - sanitized_phone: "+1..." (flat field)
//   - direct_phone: "+1..." (from enrichment)
//   - corporate_phone: "+1..." (company switchboard)
//   - mobile_phone: "+1..." (mobile)
//   - phone: "+1..." (generic)
// Returns { number, type } where type is "work_direct", "mobile", or ""
function extractPhone(person) {
  if (!person) return { number: '', type: '' };

  // Try phone_numbers array first (most common Apollo format)
  if (Array.isArray(person.phone_numbers) && person.phone_numbers.length > 0) {
    // Prefer work_direct, then mobile, then any
    const workDirect = person.phone_numbers.find(p => p.type === 'work_direct');
    const mobile = person.phone_numbers.find(p => p.type === 'mobile');
    const best = workDirect || mobile || person.phone_numbers[0];
    const num = best.sanitized_number || best.number || best.raw_number || '';
    if (num) {
      return { number: num, type: best.type || '' };
    }
  }

  // Try all known flat phone fields (Apollo returns different ones per endpoint)
  const flatFields = [
    { key: 'direct_phone', type: 'work_direct' },
    { key: 'phone_number', type: '' },
    { key: 'sanitized_phone', type: '' },
    { key: 'corporate_phone', type: 'corporate' },
    { key: 'mobile_phone', type: 'mobile' },
    { key: 'phone', type: '' },
    { key: 'work_phone', type: 'work_direct' },
  ];

  for (const { key, type } of flatFields) {
    const val = person[key];
    if (val && typeof val === 'string' && val.trim()) {
      return { number: val.trim(), type };
    }
  }

  return { number: '', type: '' };
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
async function hunterGapFillEmails(prospects, hunterApiKey, functionStart, hardDeadlineMs) {
  const needsEmail = prospects.filter(p => !p.email && p.companyDomain);

  if (needsEmail.length === 0) {
    console.log('[Hunter] All prospects have emails — skipping Hunter');
    return { attempted: 0, found: 0 };
  }

  // Cap Hunter lookups — use all available time but stop 6s before deadline
  // (reserve time for pattern guessing step after Hunter)
  const MAX_HUNTER_LOOKUPS = 10;
  const toProcess = needsEmail.slice(0, MAX_HUNTER_LOOKUPS);

  console.log(`[Hunter] ${needsEmail.length}/${prospects.length} prospects missing email — querying Hunter.io (capped at ${toProcess.length})`);

  let found = 0;
  let attempted = 0;

  // Process one at a time to respect Hunter's rate limits (free tier)
  for (const prospect of toProcess) {
    // Time budget check: stop 5s before hard deadline (leave room for pattern guessing)
    const elapsed = Date.now() - functionStart;
    if (elapsed > hardDeadlineMs - 5000) {
      console.warn(`[Hunter] Time budget hit (${Math.round(elapsed / 1000)}s elapsed) — stopping with ${toProcess.length - attempted} lookups remaining`);
      break;
    }
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
async function guessEmailPatterns(prospects, hunterApiKey, functionStart, hardDeadlineMs) {
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
  // Budget: max 8 Hunter verify API calls total to stay within Netlify Pro timeout (26s).
  // Each verify call takes ~500ms + 100ms pause = ~600ms, so 8 calls ≈ 5s max.
  // For <=3 prospects: try multiple patterns per person (up to 3 each).
  // For >3 prospects: try only the top 1-2 patterns per person.
  const MAX_VERIFY_CALLS = 8;
  let verifyCallsUsed = 0;
  const patternsPerProspect = needsEmail.length <= 3 ? 3 : 1;

  for (const prospect of needsEmail) {
    // Time budget: if we're within 2s of deadline, stop verifying and just assign best-guess emails
    const elapsed = Date.now() - functionStart;
    if (elapsed > hardDeadlineMs - 2000) {
      // Assign best-guess emails to ALL remaining prospects without verification
      console.warn(`[Pattern] Hard deadline approaching (${Math.round(elapsed / 1000)}s) — assigning best-guess emails to ${needsEmail.length - attempted} remaining prospects`);
      for (const remaining of needsEmail.slice(attempted)) {
        const rDomain = (remaining.companyDomain || '').toLowerCase();
        const rParts = (remaining.name || '').split(' ');
        const rFirst = (rParts[0] || '').toLowerCase().replace(/[^a-z]/g, '');
        const rLast = (rParts.slice(1).join(' ') || '').toLowerCase().replace(/[^a-z]/g, '');
        if (rFirst && rLast && rDomain) {
          remaining.email = `${rFirst}.${rLast}@${rDomain}`;
          remaining.emailStatus = 'pattern_guessed';
          remaining.emailSource = 'pattern';
          remaining.enrichmentStatus = remaining.linkedinUrl ? 'enriched' : 'partial';
          found++;
        }
      }
      break;
    }
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
        // Time budget check: stop 3s before hard deadline
        const elapsed = Date.now() - functionStart;
        if (elapsed > hardDeadlineMs - 3000) {
          console.warn(`[Pattern] Time budget hit (${Math.round(elapsed / 1000)}s elapsed) — using best guess for remaining`);
          verifierAvailable = false;
          break;
        }
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

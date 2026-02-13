// Netlify Function: Find & enrich prospects via Clay API
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const CLAY_API_KEY = process.env.CLAY_API_KEY;
  if (!CLAY_API_KEY) {
    return respond(500, { error: 'Clay API key not configured. Add CLAY_API_KEY to your Netlify environment variables.' });
  }

  try {
    const body = JSON.parse(event.body);
    const { industry, companySegment, companySize, jobTitles, geography, techStack, otherCriteria, prospectCount = 10 } = body;

    // Cap at 20 prospects
    const count = Math.min(parseInt(prospectCount) || 10, 20);

    // Build Clay API request
    // Clay's People Enrichment API - search for prospects matching ICP
    const clayResponse = await fetch('https://api.clay.com/v3/sources/search-people', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLAY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: count,
        filters: buildClayFilters({ industry, companySegment, companySize, jobTitles, geography, techStack, otherCriteria }),
      }),
    });

    if (!clayResponse.ok) {
      const errText = await clayResponse.text();
      console.error('Clay API error:', clayResponse.status, errText);

      // If Clay search endpoint fails, try the enrichment table approach
      return await tryClayTableApproach(CLAY_API_KEY, body, count);
    }

    const clayData = await clayResponse.json();

    // Normalize Clay response to our prospect format
    const prospects = normalizeClayProspects(clayData);

    return respond(200, {
      prospects,
      total: prospects.length,
      source: 'clay',
    });

  } catch (err) {
    console.error('Error finding prospects:', err);
    return respond(500, { error: err.message || 'Failed to find prospects' });
  }
}

// Try Clay's table/enrichment workflow approach
async function tryClayTableApproach(apiKey, params, count) {
  try {
    // Clay webhook / run table approach
    const response = await fetch('https://api.clay.com/v3/run-table', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: buildSearchQuery(params),
        limit: count,
        enrichments: ['email', 'phone', 'linkedin', 'company'],
      }),
    });

    if (!response.ok) {
      // Final fallback - Clay may require specific table ID setup
      throw new Error(
        `Clay API returned ${response.status}. Please verify your Clay API key and ensure you have a table configured. ` +
        `Visit clay.com to set up your enrichment table, then update CLAY_API_KEY in Netlify.`
      );
    }

    const data = await response.json();
    const prospects = normalizeClayProspects(data);

    return respond(200, {
      prospects,
      total: prospects.length,
      source: 'clay',
    });
  } catch (err) {
    return respond(500, { error: err.message });
  }
}

function buildClayFilters({ industry, companySegment, companySize, jobTitles, geography, techStack }) {
  const filters = {};

  if (industry) {
    filters.company_industry = Array.isArray(industry) ? industry : [industry];
  }

  if (companySize) {
    // Map the size format to Clay's min/max
    const sizeMap = {
      '1-10': { min: 1, max: 10 },
      '11-20': { min: 11, max: 20 },
      '21-50': { min: 21, max: 50 },
      '51-100': { min: 51, max: 100 },
      '101-200': { min: 101, max: 200 },
      '201-500': { min: 201, max: 500 },
      '501-1,000': { min: 501, max: 1000 },
      '1,001-2,000': { min: 1001, max: 2000 },
      '2,001-5,000': { min: 2001, max: 5000 },
      '5,001-10,000': { min: 5001, max: 10000 },
      '10,001+': { min: 10001 },
    };
    if (sizeMap[companySize]) {
      filters.company_size = sizeMap[companySize];
    }
  } else if (companySegment) {
    // If no specific size but a segment is selected, use segment ranges
    const segmentMap = {
      'SMB': { min: 1, max: 200 },
      'Midmarket': { min: 201, max: 1000 },
      'Enterprise': { min: 1001 },
    };
    if (segmentMap[companySegment]) {
      filters.company_size = segmentMap[companySegment];
    }
  }

  if (jobTitles) {
    const titles = typeof jobTitles === 'string'
      ? jobTitles.split(',').map(t => t.trim())
      : jobTitles;
    filters.job_title = titles;
  }

  if (geography) {
    filters.location = Array.isArray(geography) ? geography : [geography];
  }

  if (techStack) {
    const tools = typeof techStack === 'string'
      ? techStack.split(',').map(t => t.trim())
      : techStack;
    filters.technologies = tools;
  }

  return filters;
}

function buildSearchQuery({ industry, companySegment, companySize, jobTitles, geography, techStack, otherCriteria }) {
  const parts = [];
  if (jobTitles) parts.push(`job titles: ${jobTitles}`);
  if (industry) parts.push(`industry: ${industry}`);
  if (companySegment) parts.push(`company segment: ${companySegment}`);
  if (companySize) parts.push(`company size: ${companySize} employees`);
  if (geography) parts.push(`location: ${geography}`);
  if (techStack) parts.push(`tech stack: ${techStack}`);
  if (otherCriteria) parts.push(otherCriteria);
  return parts.join(', ');
}

function normalizeClayProspects(data) {
  // Handle different Clay response formats
  const rawItems = data.results || data.rows || data.people || data.data || [];

  return rawItems.map(item => ({
    name: item.full_name || item.name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Unknown',
    title: item.job_title || item.title || item.position || '',
    company: item.company_name || item.company || item.organization || '',
    email: item.email || item.work_email || item.professional_email || '',
    phone: item.phone || item.direct_phone || item.mobile_phone || '',
    linkedinUrl: item.linkedin_url || item.linkedin || item.linkedin_profile_url || '',
    enrichmentStatus: getEnrichmentStatus(item),
  }));
}

function getEnrichmentStatus(item) {
  const hasEmail = !!(item.email || item.work_email || item.professional_email);
  const hasPhone = !!(item.phone || item.direct_phone || item.mobile_phone);
  const hasLinkedin = !!(item.linkedin_url || item.linkedin || item.linkedin_profile_url);

  if (hasEmail && hasPhone && hasLinkedin) return 'enriched';
  if (hasEmail || hasLinkedin) return 'partial';
  return 'failed';
}

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

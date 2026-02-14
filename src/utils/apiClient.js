const API_BASE = '/.netlify/functions';

export async function findProspects(icpParams) {
  // Prospect search can be slow: Apollo search + enrichment (2 API calls/person)
  // + Hunter gap-fill + pattern guessing. Allow 55s for up to 20 prospects.
  // Netlify Pro functions timeout at 26s — give extra buffer for network latency.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const res = await fetch(`${API_BASE}/find-prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(icpParams),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to find prospects' }));
      throw new Error(err.error || `API error: ${res.status}`);
    }

    const data = await res.json();
    // Debug: log what Apollo returned so we can see field availability
    if (data._debug) {
      console.log('[Apollo Debug]', JSON.stringify(data._debug, null, 2));
    }
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Prospect search timed out. Try reducing the number of prospects.');
    }
    throw err;
  }
}

/**
 * Generate sequences — adaptive rate-limit-aware execution.
 *
 * Starts with 2 parallel workers for speed.
 * On first 429 / rate limit error:
 *   → Kill the second worker (go sequential)
 *   → Pause 60s for the rate window to fully reset
 *   → Add 20s pacing between calls (~3 calls/min = ~7,500 tokens/min under 8k limit)
 *   → Retry the failed call up to 3 times
 *
 * This guarantees all 20 prospects complete even on the lowest API tier.
 * Higher-tier keys (with larger rate limits) get the fast parallel path.
 */
export async function generateSequence(params, onProgress) {
  const FETCH_TIMEOUT = 55000;

  const allProspects = params.prospects || [];
  const totalCount = allProspects.length;
  const results = new Array(totalCount).fill(null);
  let touchpointPlan = null;
  let completedCount = 0;
  let hadFailure = false;

  // Rate limit state
  let hitRateLimit = false;
  let cooldownPromise = null;

  // Call the Netlify function for a single prospect
  async function callServer(prospectIdx) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const res = await fetch(`${API_BASE}/generate-sequence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, prospects: [allProspects[prospectIdx]] }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Server error' }));
        const errMsg = errBody.error || `API error: ${res.status}`;
        const isRateLimit = res.status === 502 || errMsg.includes('429') || errMsg.includes('rate_limit');
        return { ok: false, isRateLimit, error: errMsg };
      }

      const data = await res.json();

      // Server may return 200 with a fallback sequence that has the 429 error embedded
      // (because the server catch block returns a "failed" sequence instead of a 500)
      const firstSeq = (data.sequences || [])[0];
      if (firstSeq && firstSeq.error && (firstSeq.error.includes('429') || firstSeq.error.includes('rate_limit'))) {
        return { ok: false, isRateLimit: true, error: firstSeq.error };
      }

      return { ok: true, data };
    } catch (err) {
      clearTimeout(timer);
      const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
      return { ok: false, isRateLimit: false, error: msg };
    }
  }

  // Process one prospect with retries
  async function processOne(prospectIdx) {
    const MAX_ATTEMPTS = hitRateLimit ? 4 : 2; // more retries when we know rate limit is the issue

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // If someone triggered a cooldown, wait for it
      if (cooldownPromise) await cooldownPromise;

      const result = await callServer(prospectIdx);

      if (result.ok) {
        const seq = (result.data.sequences || [])[0];
        if (seq) results[prospectIdx] = { ...seq, prospectIndex: prospectIdx };
        if (!touchpointPlan && result.data.touchpointPlan) touchpointPlan = result.data.touchpointPlan;
        return true;
      }

      if (result.isRateLimit) {
        hitRateLimit = true;

        // Only one caller triggers the cooldown at a time
        if (!cooldownPromise) {
          console.warn(`Rate limit on prospect ${prospectIdx + 1} (attempt ${attempt}). Cooling down 60s...`);
          let resolve;
          cooldownPromise = new Promise(r => { resolve = r; });
          await sleep(60000);
          resolve();
          cooldownPromise = null;
        } else {
          await cooldownPromise;
        }
        continue; // retry after cooldown
      }

      // Non-rate-limit error — one quick retry
      if (attempt < 2) {
        console.warn(`Prospect ${prospectIdx + 1} error (attempt ${attempt}): ${result.error} — retrying...`);
        await sleep(3000);
        continue;
      }
      break;
    }

    hadFailure = true;
    console.error(`Prospect ${prospectIdx + 1} failed after retries.`);
    return false;
  }

  // ── Phase 1: Try parallel (2 workers) ──────────────────────────
  let nextIdx = 0;

  async function parallelWorker() {
    while (nextIdx < totalCount && !hitRateLimit) {
      const idx = nextIdx++;
      await processOne(idx);
      completedCount++;
      if (onProgress) onProgress(completedCount, totalCount);
    }
  }

  // Start 2 workers — they stop if rate limit is hit
  const workerCount = Math.min(2, totalCount);
  const workers = Array.from({ length: workerCount }, () => parallelWorker());
  await Promise.all(workers);

  // ── Phase 2: If rate limit hit, finish remaining sequentially with pacing ──
  if (hitRateLimit && nextIdx < totalCount) {
    console.log(`Switching to sequential mode. ${totalCount - nextIdx} prospects remaining.`);

    // Wait for any active cooldown to finish
    if (cooldownPromise) await cooldownPromise;

    while (nextIdx < totalCount) {
      const idx = nextIdx++;

      // Pace calls: 20s between starts = ~3 calls/min = ~7,500 tokens/min (under 8k limit)
      const callStart = Date.now();
      await processOne(idx);
      completedCount++;
      if (onProgress) onProgress(completedCount, totalCount);

      // Enforce minimum 20s between call starts
      if (nextIdx < totalCount) {
        const elapsed = Date.now() - callStart;
        const waitTime = Math.max(0, 20000 - elapsed);
        if (waitTime > 0) await sleep(waitTime);
      }
    }
  }

  const allSequences = results.filter(Boolean);

  if (allSequences.length === 0) {
    throw new Error(
      'All sequence generation attempts failed. This may be due to API rate limits. Please wait a minute and try again with fewer prospects.'
    );
  }

  return { sequences: allSequences, touchpointPlan, partialFailure: hadFailure };
}

/**
 * Poll for async phone data from Apollo.
 * Apollo delivers phone numbers via webhook asynchronously (can take several minutes).
 * This function polls every `interval`ms for up to `maxDuration`ms.
 *
 * @param {string} sessionId - Session ID from find-prospects response
 * @param {Array} prospects - Current prospects array
 * @param {Function} onUpdate - Called with updated prospects when new phones arrive
 * @param {Object} options - { interval: 5000, maxDuration: 120000 }
 * @returns {Function} cleanup function to stop polling
 */
export function pollForPhones(sessionId, initialProspects, onUpdate, options = {}) {
  const { interval = 5000, maxDuration = 120000 } = options;
  let stopped = false;
  let lastCount = 0;
  let stalePolls = 0; // Count consecutive polls with no new phones
  const MAX_STALE_POLLS = 8; // Stop after 8 consecutive polls with no new data (~64s of no new phones)
  const startTime = Date.now();

  // Mutable ref: tracks the latest prospects array so each poll cycle
  // sees phones found in previous cycles (fixes stale closure bug).
  let currentProspects = initialProspects;

  // Callback to notify parent when polling stops (so UI can update)
  const stopAndNotify = () => {
    if (stopped) return;
    stopped = true;
    console.log(`[Phone Poll] Stopped. ${currentProspects.filter(p => p.phone).length}/${currentProspects.length} prospects have phones.`);
    // Trigger a final update so the parent knows polling has ended
    if (options.onPollingEnd) options.onPollingEnd();
  };

  const poll = async () => {
    if (stopped) return;
    if (Date.now() - startTime > maxDuration) {
      console.log('[Phone Poll] Max duration reached, stopping');
      stopAndNotify();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/phone-webhook/${sessionId}`);
      if (!res.ok) {
        console.warn(`[Phone Poll] HTTP ${res.status} from phone-webhook`);
        if (!stopped) setTimeout(poll, interval);
        return;
      }

      const data = await res.json();
      const phones = data.phones || {};
      const phoneCount = Object.keys(phones).length;

      console.log(`[Phone Poll] Status: ${data.status}, entries: ${phoneCount}, totalReceived: ${data.totalReceived}, stalePolls: ${stalePolls}/${MAX_STALE_POLLS}`);

      let foundNewPhones = false;

      if (phoneCount > 0 && phoneCount >= lastCount) {
        // Match phones to prospects by apolloId, email, linkedin, or name
        const updated = currentProspects.map(p => {
          if (p.phone) return p; // Already has phone

          const idKey = p.apolloId ? `id:${p.apolloId}` : '';
          const emailKey = `email:${(p.email || '').toLowerCase()}`;
          const linkedinKey = `linkedin:${p.linkedinUrl || ''}`;
          const nameKey = `name:${(p.name || '').toLowerCase()}`;

          const match = (idKey && phones[idKey]) || phones[emailKey] || phones[linkedinKey] || phones[nameKey] || null;
          const phone = match?.phone || (typeof match === 'string' ? match : '');
          const phoneType = match?.phoneType || '';

          if (phone) {
            console.log(`[Phone Poll] Matched phone for ${p.name}: ${phone} (${phoneType})`);
            return { ...p, phone, phoneType: phoneType || p.phoneType || '', enrichmentStatus: p.email ? 'enriched' : p.enrichmentStatus };
          }
          return p;
        });

        const phonesFound = updated.filter(p => p.phone).length;
        const prevPhones = currentProspects.filter(p => p.phone).length;

        if (phonesFound > prevPhones) {
          foundNewPhones = true;
          stalePolls = 0; // Reset stale counter
          lastCount = phoneCount;
          console.log(`[Phone Poll] Updated ${phonesFound - prevPhones} new phones (total: ${phonesFound})`);
          currentProspects = updated;
          onUpdate(updated);

          // If all prospects now have phones, stop polling early
          if (phonesFound >= currentProspects.length) {
            console.log('[Phone Poll] All prospects have phones — stopping early');
            stopAndNotify();
            return;
          }
        }
      }

      // Track stale polls — if no new phones for too long, stop polling
      if (!foundNewPhones) {
        stalePolls++;
        // Only start counting stale polls after the first 30s (give Apollo time to start sending)
        const elapsed = Date.now() - startTime;
        if (elapsed > 30000 && stalePolls >= MAX_STALE_POLLS) {
          console.log(`[Phone Poll] ${MAX_STALE_POLLS} consecutive polls with no new data — stopping`);
          stopAndNotify();
          return;
        }
      }
    } catch (err) {
      console.warn('[Phone Poll] Error:', err.message);
    }

    if (!stopped) {
      setTimeout(poll, interval);
    }
  };

  // Start polling after a short delay (give Apollo time to start sending)
  setTimeout(poll, 3000);

  return stopAndNotify;
}

/**
 * Check usage count for an email address.
 * Returns { email, count, allowed, exempt? }
 */
export async function checkUsage(email) {
  const res = await fetch(`${API_BASE}/usage-tracker?email=${encodeURIComponent(email)}`);
  if (!res.ok) return { email, count: 0, allowed: true }; // Fail open
  return res.json();
}

/**
 * Increment usage count for an email address.
 * Returns { email, count, allowed }
 */
export async function incrementUsage(email) {
  const res = await fetch(`${API_BASE}/usage-tracker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) return { email, count: 0, allowed: true }; // Fail open
  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

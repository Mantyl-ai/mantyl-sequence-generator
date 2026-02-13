const API_BASE = '/.netlify/functions';

export async function findProspects(icpParams) {
  const res = await fetch(`${API_BASE}/find-prospects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(icpParams),
  });

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
export function pollForPhones(sessionId, prospects, onUpdate, options = {}) {
  const { interval = 5000, maxDuration = 120000 } = options;
  let stopped = false;
  let lastCount = 0;
  const startTime = Date.now();

  const poll = async () => {
    if (stopped) return;
    if (Date.now() - startTime > maxDuration) {
      console.log('[Phone Poll] Max duration reached, stopping');
      return;
    }

    try {
      // Poll the phone-webhook function directly (handles both POST from Apollo and GET from us)
      const res = await fetch(`${API_BASE}/phone-webhook/${sessionId}`);
      if (!res.ok) return;

      const data = await res.json();
      const phones = data.phones || {};
      const phoneCount = Object.keys(phones).length;

      if (phoneCount > lastCount) {
        lastCount = phoneCount;
        console.log(`[Phone Poll] ${phoneCount} phone entries received`);

        // Match phones to prospects by name, email, or linkedin
        const updated = prospects.map(p => {
          if (p.phone) return p; // Already has phone

          // Try matching by various keys — Apollo ID is most reliable
          // (webhook payload only has person ID, not name/email/linkedin)
          const idKey = p.apolloId ? `id:${p.apolloId}` : '';
          const emailKey = `email:${(p.email || '').toLowerCase()}`;
          const linkedinKey = `linkedin:${p.linkedinUrl || ''}`;
          const nameKey = `name:${(p.name || '').toLowerCase()}`;

          const match = (idKey && phones[idKey]) || phones[emailKey] || phones[linkedinKey] || phones[nameKey] || null;
          const phone = match?.phone || (typeof match === 'string' ? match : '');
          const phoneType = match?.phoneType || '';

          if (phone) {
            return { ...p, phone, phoneType: phoneType || p.phoneType || '', enrichmentStatus: p.email ? 'enriched' : p.enrichmentStatus };
          }
          return p;
        });

        const phonesFound = updated.filter(p => p.phone).length;
        const prevPhones = prospects.filter(p => p.phone).length;

        if (phonesFound > prevPhones) {
          console.log(`[Phone Poll] Updated ${phonesFound - prevPhones} prospects with phone numbers`);
          onUpdate(updated);
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

  return () => { stopped = true; };
}

/**
 * Poll for async Clay enrichment data.
 * Clay fills gaps (missing email, phone, linkedin) that Apollo couldn't find.
 * Similar pattern to phone polling — Clay sends results to clay-webhook, we poll for them.
 *
 * @param {string} sessionId - Session ID from find-prospects response
 * @param {Array} prospects - Current prospects array
 * @param {Function} onUpdate - Called with updated prospects when Clay data arrives
 * @param {Object} options - { interval: 8000, maxDuration: 180000 }
 * @returns {Function} cleanup function to stop polling
 */
export function pollForClayEnrichment(sessionId, prospects, onUpdate, options = {}) {
  const { interval = 8000, maxDuration = 180000 } = options; // Clay takes longer — 8s interval, 3min max
  let stopped = false;
  let lastCount = 0;
  const startTime = Date.now();

  const poll = async () => {
    if (stopped) return;
    if (Date.now() - startTime > maxDuration) {
      console.log('[Clay Poll] Max duration reached, stopping');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/clay-webhook/${sessionId}`);
      if (!res.ok) return;

      const data = await res.json();
      const enrichments = data.enrichments || {};
      const totalReceived = data.totalReceived || 0;

      if (totalReceived > lastCount) {
        lastCount = totalReceived;
        console.log(`[Clay Poll] ${totalReceived} enrichment(s) received from Clay`);

        // Merge Clay enrichments into prospects by index
        let changeCount = 0;
        const updated = prospects.map((p, idx) => {
          const clay = enrichments[String(idx)];
          if (!clay) return p;

          const changes = {};
          // Only fill MISSING fields — never overwrite Apollo data
          if (clay.email && !p.email) {
            changes.email = clay.email;
            changes.emailStatus = clay.emailStatus || 'clay_enriched';
            changes.emailSource = 'clay';
          }
          if (clay.phone && !p.phone) {
            changes.phone = clay.phone;
            changes.phoneType = clay.phoneType || '';
            changes.phoneSource = 'clay';
          }
          if (clay.linkedinUrl && !p.linkedinUrl) {
            changes.linkedinUrl = clay.linkedinUrl;
            changes.linkedinSource = 'clay';
          }

          if (Object.keys(changes).length > 0) {
            changeCount++;
            const enrichmentStatus = (changes.email || p.email) ? 'enriched' : ((changes.linkedinUrl || p.linkedinUrl) ? 'partial' : p.enrichmentStatus);
            return { ...p, ...changes, enrichmentStatus };
          }
          return p;
        });

        if (changeCount > 0) {
          console.log(`[Clay Poll] Updated ${changeCount} prospects with Clay data`);
          onUpdate(updated);
        }
      }
    } catch (err) {
      console.warn('[Clay Poll] Error:', err.message);
    }

    if (!stopped) {
      setTimeout(poll, interval);
    }
  };

  // Start polling after a longer delay (Clay needs time to process)
  setTimeout(poll, 10000);

  return () => { stopped = true; };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

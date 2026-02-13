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

  return res.json();
}

/**
 * Generate sequences with adaptive rate-limit-aware execution.
 *
 * Strategy:
 *   - Start with 2 parallel workers (fast path for higher-tier API keys)
 *   - If we hit a 429 rate limit, automatically throttle:
 *       → pause 60s to let the rate limit window reset
 *       → add a 10s delay between subsequent calls
 *   - Each prospect gets 1 Netlify function call (fits in 26s timeout)
 *   - Failed calls retry up to 3× for rate limits, 1× for other errors
 *   - Partial results always shown even if some prospects fail
 *
 * @param {Object} params - Full generation params including prospects array
 * @param {Function} onProgress - Callback: (completedCount, totalCount) => void
 * @returns {Promise<Object>} - { sequences, touchpointPlan, partialFailure }
 */
export async function generateSequence(params, onProgress) {
  const INITIAL_CONCURRENCY = 2;
  const FETCH_TIMEOUT = 55000;

  const allProspects = params.prospects || [];
  const totalCount = allProspects.length;
  const results = new Array(totalCount).fill(null);
  let touchpointPlan = null;
  let completedCount = 0;
  let hadFailure = false;

  // Adaptive rate limiting state (shared across workers)
  let callDelay = 0;        // ms to wait between calls (increases on 429)
  let rateLimitHit = false;  // flag to signal workers to slow down
  let rateLimitPause = null; // promise that resolves after rate limit cooldown

  async function processOne(prospectIdx) {
    const chunk = [allProspects[prospectIdx]];
    const MAX_RETRIES_429 = 3;
    const MAX_RETRIES_OTHER = 1;
    let lastErr = null;
    let attempts = 0;
    const maxAttempts = MAX_RETRIES_429 + 1; // worst case all 429s

    while (attempts < maxAttempts) {
      attempts++;

      // If a rate limit cooldown is in progress, wait for it
      if (rateLimitPause) {
        await rateLimitPause;
      }

      // Respect the adaptive delay between calls
      if (callDelay > 0) {
        await sleep(callDelay);
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        const res = await fetch(`${API_BASE}/generate-sequence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, prospects: chunk }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: 'Server error' }));
          const errMsg = errBody.error || `API error: ${res.status}`;

          // Check if this is a rate limit error (429 from Claude API, passed through)
          const is429 = res.status === 502 || errMsg.includes('429') || errMsg.includes('rate_limit');

          if (is429) {
            lastErr = new Error(errMsg);

            // Only one worker should trigger the global cooldown
            if (!rateLimitHit) {
              rateLimitHit = true;
              callDelay = 10000; // 10s between calls from now on
              console.warn(`Rate limit hit on prospect ${prospectIdx + 1}. Pausing 60s and adding ${callDelay / 1000}s delay between calls.`);

              // Create a shared pause promise — all workers wait on this
              let resolve;
              rateLimitPause = new Promise(r => { resolve = r; });
              await sleep(60000); // 60s cooldown
              resolve();
              rateLimitPause = null;
              rateLimitHit = false;
            } else {
              // Another worker already triggered cooldown — just wait for it
              if (rateLimitPause) await rateLimitPause;
            }

            continue; // retry after cooldown
          }

          // Non-429 error
          throw new Error(errMsg);
        }

        const data = await res.json();

        const seq = (data.sequences || [])[0];
        if (seq) {
          results[prospectIdx] = { ...seq, prospectIndex: prospectIdx };
        }
        if (!touchpointPlan && data.touchpointPlan) {
          touchpointPlan = data.touchpointPlan;
        }
        return; // success
      } catch (err) {
        if (err.name === 'AbortError') {
          lastErr = new Error('Request timed out');
        } else {
          lastErr = err;
        }

        // For non-429 errors, allow 1 retry with brief pause
        const retriesLeft = MAX_RETRIES_OTHER - (attempts - 1);
        if (retriesLeft > 0 && !lastErr.message.includes('429')) {
          console.warn(`Prospect ${prospectIdx + 1} attempt ${attempts} failed: ${lastErr.message} — retrying...`);
          await sleep(3000);
          continue;
        }
        break; // give up
      }
    }

    // All retries exhausted
    hadFailure = true;
    console.error(`Prospect ${prospectIdx + 1} failed after ${attempts} attempts:`, lastErr?.message);
  }

  // Worker pool with adaptive concurrency
  async function runPool() {
    let nextIdx = 0;
    const concurrency = Math.min(INITIAL_CONCURRENCY, totalCount);

    async function worker() {
      while (nextIdx < totalCount) {
        const idx = nextIdx++;
        await processOne(idx);
        completedCount++;
        if (onProgress) onProgress(completedCount, totalCount);
      }
    }

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
  }

  await runPool();

  const allSequences = results.filter(Boolean);

  if (allSequences.length === 0) {
    throw new Error(
      'All sequence generation attempts failed. This may be due to API rate limits. Please wait a minute and try again with fewer prospects.'
    );
  }

  return { sequences: allSequences, touchpointPlan, partialFailure: hadFailure };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

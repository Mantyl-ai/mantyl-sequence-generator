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
 * Generate sequences with parallel concurrency + retry.
 *
 * Strategy: send 1 prospect per Netlify function call (fits safely in 26s
 * timeout) but run CONCURRENCY calls in parallel for speed.
 * If a call fails, retry it once before giving up on that prospect.
 *
 * 20 prospects × 1 per call × 3 concurrent = ~7 rounds × 15s ≈ 2 min
 *
 * @param {Object} params - Full generation params including prospects array
 * @param {Function} onProgress - Callback: (completedCount, totalCount) => void
 * @returns {Promise<Object>} - { sequences, touchpointPlan, partialFailure }
 */
export async function generateSequence(params, onProgress) {
  const CONCURRENCY = 3;   // parallel Netlify function calls
  const MAX_RETRIES = 1;   // retry failed calls once
  const FETCH_TIMEOUT = 55000; // 55s client timeout (above Netlify's 26s)

  const allProspects = params.prospects || [];
  const totalCount = allProspects.length;
  const results = new Array(totalCount).fill(null);
  let touchpointPlan = null;
  let completedCount = 0;
  let hadFailure = false;

  // Build individual tasks — one per prospect
  const tasks = allProspects.map((_, idx) => idx);

  // Process tasks with concurrency pool
  async function processOne(prospectIdx) {
    const chunk = [allProspects[prospectIdx]];
    let lastErr = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
          const err = await res.json().catch(() => ({ error: 'Server error' }));
          throw new Error(err.error || `API error: ${res.status}`);
        }

        const data = await res.json();

        // Store result with correct global index
        const seq = (data.sequences || [])[0];
        if (seq) {
          results[prospectIdx] = { ...seq, prospectIndex: prospectIdx };
        }
        if (!touchpointPlan && data.touchpointPlan) {
          touchpointPlan = data.touchpointPlan;
        }
        return; // success — exit retry loop
      } catch (err) {
        lastErr = err;
        const isRetryable = attempt < MAX_RETRIES;
        console.warn(
          `Prospect ${prospectIdx + 1} attempt ${attempt + 1} failed: ${err.message}` +
          (isRetryable ? ' — retrying...' : ' — giving up')
        );
        if (isRetryable) {
          // Brief pause before retry
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    // All retries exhausted — mark as failed but don't crash the pipeline
    hadFailure = true;
    console.error(`Prospect ${prospectIdx + 1} failed after retries:`, lastErr?.message);
  }

  // Concurrent executor — runs up to CONCURRENCY tasks at once
  async function runPool() {
    let nextIdx = 0;

    async function worker() {
      while (nextIdx < tasks.length) {
        const idx = tasks[nextIdx++];
        await processOne(idx);
        completedCount++;
        if (onProgress) onProgress(completedCount, totalCount);
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker());
    await Promise.all(workers);
  }

  await runPool();

  // Collect successful results (filter out nulls from failed prospects)
  const allSequences = results.filter(Boolean);

  if (allSequences.length === 0) {
    throw new Error(
      'All sequence generation attempts failed. This is usually caused by high server load. Please wait a moment and try again.'
    );
  }

  return { sequences: allSequences, touchpointPlan, partialFailure: hadFailure };
}

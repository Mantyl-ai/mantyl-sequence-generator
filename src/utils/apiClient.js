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
 * Generate sequences with client-side chunking.
 * Splits prospects into small batches (3 per call) so each serverless
 * invocation fits within Netlify's 26s timeout, even at 12 touchpoints.
 *
 * @param {Object} params - Full generation params including prospects array
 * @param {Function} onProgress - Callback: (completedCount, totalCount) => void
 * @returns {Promise<Object>} - { sequences, touchpointPlan }
 */
export async function generateSequence(params, onProgress) {
  const CHUNK_SIZE = 2;
  const allProspects = params.prospects || [];
  const totalCount = allProspects.length;
  const allSequences = [];
  let touchpointPlan = null;

  let lastError = null;

  for (let i = 0; i < totalCount; i += CHUNK_SIZE) {
    const chunk = allProspects.slice(i, i + CHUNK_SIZE);

    try {
      const res = await fetch(`${API_BASE}/generate-sequence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          prospects: chunk,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to generate sequence' }));
        throw new Error(err.error || `API error: ${res.status}`);
      }

      const data = await res.json();

      // Fix prospect indices to be global (not per-chunk)
      const fixedSequences = (data.sequences || []).map((seq, idx) => ({
        ...seq,
        prospectIndex: i + idx,
      }));

      allSequences.push(...fixedSequences);
      if (!touchpointPlan && data.touchpointPlan) {
        touchpointPlan = data.touchpointPlan;
      }
    } catch (err) {
      console.error(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1} failed:`, err.message);
      lastError = err;
      // Continue to next chunk — preserve partial results
    }

    if (onProgress) {
      onProgress(Math.min(i + CHUNK_SIZE, totalCount), totalCount);
    }
  }

  // If ALL chunks failed, throw the last error
  if (allSequences.length === 0 && lastError) {
    throw lastError;
  }

  return { sequences: allSequences, touchpointPlan, partialFailure: !!lastError };
}

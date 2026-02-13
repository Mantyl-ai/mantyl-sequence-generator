# Architecture

Technical deep-dive into the Mantyl Sequence Generator system design. This document is intended for engineers evaluating, extending, or maintaining the codebase.

## System Overview

The application is a serverless SPA that orchestrates multiple third-party APIs to deliver an end-to-end outbound sales workflow. There is no database, no user authentication, and no persistent server state. All data flows through the client and is ephemeral by design.

```
                          ┌──────────────┐
                          │   Browser    │
                          │  (React SPA) │
                          └──────┬───────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
              POST /find-  POST /generate- GET /phone-
              prospects    sequence        webhook/:id
                    │            │            │
           ┌────────▼──┐  ┌─────▼─────┐  ┌──▼──────────┐
           │  Netlify   │  │  Netlify  │  │   Netlify   │
           │  Function  │  │  Function │  │   Function  │
           └──┬──┬──┬───┘  └─────┬─────┘  └──┬──────────┘
              │  │  │            │            │
     ┌────────┘  │  └──────┐    │            │
     │           │         │    │            │
┌────▼───┐ ┌────▼───┐ ┌───▼──┐ ┌▼──────┐  ┌─▼──────┐
│Apollo  │ │Hunter  │ │Email │ │Claude │  │ /tmp/  │
│Search  │ │Finder  │ │Pat.  │ │ API   │  │ Store  │
│+ Enrich│ │+Verify │ │Engine│ │       │  │        │
└────────┘ └────────┘ └──────┘ └───────┘  └────────┘
```

## Request Lifecycle

### Phase 1: Prospect Discovery (`find-prospects.js`)

The client submits ICP parameters. The serverless function executes a 4-step enrichment pipeline synchronously (with the exception of phone data, which is async):

**Step 1 — Apollo Search**
```
POST https://api.apollo.io/v1/mixed_people/search
```
Sends organization filters (industry, employee count, tech stack, keywords) and person filters (titles, geography). Returns up to 20 contacts with basic profile data. Each result includes: name, title, company, LinkedIn URL, and sometimes email/phone.

**Step 2 — Apollo Enrich**
```
POST https://api.apollo.io/v1/people/match
```
For each prospect, requests individual enrichment to fill in email, phone, company domain, and organization details. Results are merged back into the prospect objects. Apollo may also trigger an asynchronous phone lookup via webhook (see Phase 3).

**Step 3 — Hunter.io Gap-Fill**
```
GET https://api.hunter.io/v2/email-finder?domain={domain}&first_name={first}&last_name={last}
```
For prospects still missing an email after Apollo enrichment, Hunter's Email Finder attempts to locate the address. Emails with confidence score ≥80 are tagged `hunter_verified`; scores 50–79 are tagged `hunter_guessed`. The function exits this step early on 429 (rate limit) or 402 (quota exhausted) to avoid burning the entire allocation.

**Step 4 — Pattern-Based Email Inference**

For any prospects still without an email:

1. **Domain inference**: If Apollo didn't return `companyDomain`, the engine infers it from the company name (strips corporate suffixes like Inc/LLC/Group, lowercases, appends `.com`) or extracts it from the LinkedIn company URL slug.

2. **Pattern detection**: Scans prospects that already have emails to detect the company's email pattern (e.g., `first.last@domain.com` → pattern `first.last`).

3. **Candidate generation**: Produces 5 email candidates per prospect using common corporate patterns ordered by industry frequency:
   - `first.last@domain.com` (~55% of companies)
   - `first@domain.com` (~15%)
   - `flast@domain.com` (~12%)
   - `firstl@domain.com` (~8%)
   - `first_last@domain.com` (~5%)

4. **Verification** (if Hunter API key available):
   ```
   GET https://api.hunter.io/v2/email-verifier?email={candidate}
   ```
   Iterates through candidates until one returns `valid` or `accept_all`. Falls back to the first candidate (usually `first.last`) if verification is unavailable or quota is exhausted.

5. **Assignment**: Every prospect is guaranteed to exit with an email. Status is tagged as `verified` (if Hunter confirmed), `pattern_guessed` (if inferred without verification), and source as `pattern`.

**Response shape:**
```json
{
  "prospects": [...],
  "total": 20,
  "source": "apollo+hunter",
  "sessionId": "abc123",
  "_debug": {
    "apolloStats": { "searched": 20, "enriched": 18 },
    "hunterStats": { "attempted": 5, "found": 3 },
    "patternStats": { "attempted": 2, "found": 2 }
  }
}
```

### Phase 2: Sequence Generation (`generate-sequence.js`)

The client sends the enriched prospect array along with sequence configuration (channels, tone, touchpoint count, day spacing, sender profile, product context).

**Execution model:**

The function processes one prospect per invocation (the client calls it N times). This was a deliberate design choice: individual function invocations are more resilient to timeouts than batch processing within a single 10-second Netlify Function window.

**Client-side orchestration** (`apiClient.js`) manages parallelism:

1. Starts 2 parallel workers
2. On first 429/rate-limit error:
   - Kills the second worker (goes sequential)
   - Pauses 60 seconds for the rate window to reset
   - Adds 20-second pacing between calls (~3 calls/min)
   - Retries the failed call up to 3 additional times
3. Reports progress via callback: `onProgress(completed, total)`

This adaptive strategy ensures completion on any API tier. Higher-tier keys get parallel throughput; free-tier keys still complete all 20 prospects sequentially.

**Claude prompt structure:**
- System prompt: tone instructions, channel-specific rules (email subjects, LinkedIn character limits, call scripts), sender sign-off block, formatting rules (no em-dashes, no bullet points in emails)
- User prompt: prospect data (name, title, company, industry), product description, pain point, proposed solution, CTA language
- Output: structured JSON array of touchpoints, each with `day`, `channel`, `subject` (email only), `body`

### Phase 3: Phone Webhook Polling (`phone-webhook.js`)

Apollo delivers phone numbers asynchronously after the initial search. The architecture:

1. `find-prospects.js` generates a `sessionId` (UUID) and passes it to Apollo
2. Apollo POSTs phone data to `/.netlify/functions/phone-webhook` as results become available
3. The webhook handler writes data to `/tmp/{sessionId}.json`
4. The client polls `GET /phone-webhook/{sessionId}` every 5 seconds
5. `apiClient.js` matches returned phones to prospects by `apolloId`, email, LinkedIn URL, or name
6. Polling stops after 2 minutes or when all prospects have phones

**Data storage**: `/tmp/` is ephemeral on Netlify Functions — data is cleared on cold start. This is intentional: no persistent PII storage.

## Frontend Architecture

### State Management

All state lives in `App.jsx` via `useState` hooks. No external state library.

| State | Type | Purpose |
|-------|------|---------|
| `step` | `'form' \| 'loading' \| 'results'` | Controls which view is rendered |
| `prospects` | `Array<Prospect>` | Enriched prospect data (updated by phone polling) |
| `sequences` | `Array<Sequence>` | Generated sequence copy per prospect |
| `selectedProspect` | `number` | Index of currently selected prospect in results view |
| `phonePollingActive` | `boolean` | Whether async phone polling is in progress |
| `formData` | `object` | Cached ICP form submission for sender profile reference |
| `usageCount` | `number` | localStorage counter for CTA gating |

### Component Hierarchy

```
App
├── ICPForm                    (step === 'form')
│   ├── Industry selector      (14 categories, 156 industries)
│   ├── Company segment/size   (SMB/Midmarket/Enterprise + employee range)
│   ├── Job titles input       (multi-value)
│   ├── Geography selector
│   ├── Tech stack input
│   ├── Sequence config        (channels, touchpoints, tone, spacing)
│   ├── Product context        (description, pain point, solution, CTA)
│   └── Sender profile         (name, title, company, phone, LinkedIn, Calendly)
│
├── MantylLoader               (step === 'loading')
│   └── Animated SVG + progress text
│
├── ProspectList               (step === 'results')
│   ├── Table with enrichment status dots
│   ├── Email validation badges (✓ / ~ / ?)
│   ├── Phone type badges (Direct / Mobile)
│   ├── LinkedIn profile links
│   └── CSV export button
│
└── SequenceCopy               (step === 'results')
    ├── Prospect selector dropdown
    ├── Touchpoint cards (day, channel, subject, body)
    └── Copy-to-clipboard per touchpoint
```

### Data Flow

```
User fills form
    │
    ▼
handleSubmit()
    │
    ├── findProspects(icpParams)          → POST /find-prospects
    │       │
    │       ├── setProspects(data)         → ProspectList renders
    │       └── pollForPhones(sessionId)   → Updates prospects async
    │
    └── generateSequence(params, onProgress)  → POST /generate-sequence (×N)
            │
            └── setSequences(data)         → SequenceCopy renders
```

## API Rate Limit Strategy

| API | Limit | Strategy |
|-----|-------|----------|
| Apollo Search | Varies by plan | Single call per run, capped at 20 results |
| Apollo Enrich | Varies by plan | Sequential with 100ms delay |
| Hunter Finder | 25/month (free) | Sequential with 300ms delay; stops on 429/402 |
| Hunter Verifier | 50/month (free) | Sequential with 200ms delay; stops on 429/402 |
| Claude | 8k tokens/min (free) | Adaptive: 2 parallel → sequential + 20s pacing on 429 |

## Security Model

1. **No client-side secrets**: All API keys live in Netlify environment variables. Serverless functions execute server-side. The browser never sees any key.

2. **No database**: Zero persistent data storage. Prospect data exists only in browser memory during the session and in ephemeral `/tmp/` during phone polling.

3. **No authentication**: The application is stateless and anonymous. Usage gating is client-side only (localStorage counter) — it is not a security boundary.

4. **CORS**: Configured in `netlify.toml`. Currently set to `*` for development. Production deployments should restrict to the application's domain.

5. **Input validation**: Serverless functions validate required fields and sanitize ICP parameters before sending to third-party APIs.

## Design Decisions and Trade-offs

**Why serverless (not a persistent server)?**
Zero infrastructure management. Each function invocation is isolated. No connection pools, no session management, no scaling configuration. The trade-off is the 10-second execution limit on Netlify's free tier, which drove the one-prospect-per-invocation design for sequence generation.

**Why waterfall enrichment (not parallel)?**
Cost optimization. Apollo is called first because it's included in the search credits. Hunter is only invoked for gaps. Pattern guessing is free. Running all three in parallel would waste Hunter API calls on prospects Apollo already resolved.

**Why client-side sequence orchestration?**
Netlify Functions have a 10-second timeout (26s on Pro). Generating 20 sequences via Claude takes 2–5 minutes. Moving orchestration to the client allows the function to handle one prospect per invocation (well within the timeout) while the client manages parallelism, retries, and progress reporting.

**Why `/tmp/` for phone data?**
Apollo delivers phone data asynchronously via webhook. Netlify Functions are stateless — there is no shared memory between invocations. `/tmp/` is the only writable filesystem available in Netlify Functions and persists within the same execution environment (but not across cold starts). For the 2-minute polling window, this is sufficient. A production-grade implementation would use a key-value store (e.g., Netlify Blobs, Redis, or DynamoDB).

**Why pattern guessing always assigns an email?**
In outbound sales, a possibly-wrong email is more useful than no email. Bounce rates are trackable and expected. Leaving a prospect without an email makes them unreachable entirely. The pattern engine's frequency-weighted approach typically achieves 60–70% accuracy on first-guess, improving significantly when it can detect patterns from known emails at the same domain.

## Extending the System

### Adding a New Enrichment Provider

1. Add the provider's API key to `.env.example` and document it
2. Add a new step function in `find-prospects.js` following the existing pattern:
   ```javascript
   async function newProviderGapFill(prospects, apiKey) {
     const needsData = prospects.filter(p => /* gap condition */);
     // ... API calls with rate limit handling ...
     return { attempted: X, found: Y };
   }
   ```
3. Call it in the pipeline after the appropriate step
4. Update `_debug` info in the response
5. Update badge logic in `ProspectList.jsx` if new status values are introduced

### Adding a New Sequence Channel

1. Add the channel option to `ICPForm.jsx` channel selector
2. Update the Claude system prompt in `generate-sequence.js` with channel-specific formatting rules
3. Update `SequenceCopy.jsx` to render the new channel's touchpoints appropriately
4. Update CSV export in `csvExport.js`

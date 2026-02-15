# Mantyl Sequence Generator

**AI-powered outbound prospecting engine** that discovers, enriches, and activates sales prospects — from ICP definition to ready-to-send multi-channel sequences in under 60 seconds.

Built by [mantyl.ai](https://mantyl.ai) — AI-Powered GTM Automation.

**Live:** [sequencer.mantyl.ai](https://sequencer.mantyl.ai)

---

## What This Does

Traditional outbound sales requires stitching together 4–6 tools: a lead database, an enrichment layer, an email verifier, a copywriter, and a sequencer. This application collapses that into a single workflow:

1. **Define your ICP** — industry, company segment, size, titles, geography, tech stack
2. **Prospect discovery** — searches 270M+ B2B contacts via Apollo.io with real-time enrichment
3. **Waterfall email enrichment** — Apollo → Hunter.io → pattern-based inference with verification
4. **Async phone enrichment** — direct dials and mobile numbers delivered via webhook polling
5. **AI-generated sequences** — Claude produces personalized multi-channel copy (email, LinkedIn, phone) per prospect

Every prospect gets a unique sequence informed by their role, company, industry, and your product context.

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     React 18 + Vite 6                       │
│                  Single Page Application                    │
│                                                             │
│   ICPForm ──→ MantylLoader ──→ ProspectList + SequenceCopy  │
└────────────────┬────────────────┬──────────────┬───────────┘
                 │                │              │
          POST /find-     POST /generate-   GET /phone-
          prospects       sequence          webhook/:id
                 │                │              │
   ┌─────────────▼────┐  ┌───────▼────────┐  ┌──▼──────────┐
   │  find-prospects   │  │ generate-      │  │ phone-      │
   │                   │  │ sequence       │  │ webhook     │
   │  4-Step Pipeline: │  │                │  │             │
   │  1. Apollo Search │  │ Claude API     │  │ Apollo      │
   │  2. Apollo Enrich │  │ (Sonnet 4.5)   │  │ Async       │
   │  3. Hunter.io     │  │                │  │ Delivery    │
   │  4. Pattern Guess │  │ Adaptive rate  │  │             │
   └──────────────────┘  │ limiting       │  │ /tmp/ store │
                          └────────────────┘  └─────────────┘
```

### Enrichment Pipeline

The enrichment pipeline uses a **waterfall strategy** — each step fills gaps left by the previous one, maximizing data coverage without redundant API spend.

| Step | Provider | What It Does | Fallback Trigger |
|------|----------|-------------|-----------------|
| 1. Search | Apollo.io | Bulk people search with ICP filters, returns name, title, company, LinkedIn | — |
| 2. Enrich | Apollo.io | Individual enrichment for email, phone, domain, org data | — |
| 3. Gap-Fill | Hunter.io | Email Finder API for prospects missing email after Apollo | `!prospect.email && prospect.companyDomain` |
| 4. Inference | Pattern Engine | Constructs emails from common corporate patterns, verifies via Hunter Email Verifier | `!prospect.email` (always assigns) |

**Pattern engine details:** Detects email patterns from known contacts at the same domain (e.g., if `john.doe@acme.com` exists, infers `first.last` pattern). Falls back to frequency-weighted guessing: `first.last` (55%), `first` (15%), `flast` (12%), `firstl` (8%), `first_last` (5%). Infers domains from company names when Apollo doesn't return one.

### Sequence Generation

Claude generates sequences using an **Opening → Value Add → Closing** arc with prospect-specific personalization:

| Position | Stage | Purpose |
|----------|-------|---------|
| First 30% | Opening | Introduce, reference prospect's role/company, spark curiosity |
| Middle 40% | Value Add | Share insights, case studies, industry trends — no hard sell |
| Final 30% | Closing | Specific ask (demo/call/meeting), create urgency |

The generation engine uses **adaptive rate limiting**: starts with 2 parallel workers for throughput, detects 429 responses, and falls back to sequential execution with 20-second pacing. Retries up to 4 times per prospect. This guarantees completion even on the lowest API tier.

## Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Frontend | React 18, Vite 6 | SPA with optimistic UI, real-time progress indicators |
| Backend | Netlify Functions (Node.js) | 4 serverless functions, esbuild bundled |
| Prospect Data | Apollo.io API | Search + enrichment, 270M+ contact database |
| Email Gap-Fill | Hunter.io API | Email Finder + Email Verifier endpoints |
| Copy Generation | Anthropic Claude API | `claude-sonnet-4-5-20250929`, structured JSON output |
| Phone Delivery | Apollo Webhook → `/tmp/` store | Async phone enrichment with polling |
| Styling | Custom CSS | 1,400+ lines, Mantyl design system, fully responsive |
| Deployment | Netlify | Git-push deploy, automatic HTTPS, edge CDN |

## Project Structure

```
sequence-generator/
├── src/
│   ├── components/
│   │   ├── ICPForm.jsx            # ICP parameters, sender profile, sequence settings
│   │   ├── ProspectList.jsx       # Enriched prospect table with status badges
│   │   ├── SequenceCopy.jsx       # Per-prospect sequence viewer with copy/paste
│   │   └── MantylLoader.jsx       # Branded loading animation
│   ├── utils/
│   │   ├── apiClient.js           # API client with adaptive rate limiting + phone polling
│   │   └── csvExport.js           # CSV export for prospects + sequences
│   ├── App.jsx                    # Root state management, orchestration
│   ├── main.jsx                   # Entry point
│   └── index.css                  # Mantyl design system (CSS custom properties)
├── netlify/
│   └── functions/
│       ├── find-prospects.js      # 4-step enrichment pipeline (Apollo → Hunter → Pattern)
│       ├── generate-sequence.js   # Claude API with tone/context/sender threading
│       ├── phone-webhook.js       # Apollo async phone data receiver + polling endpoint
│       └── get-phones.js          # Phone data retrieval endpoint
├── public/
│   └── logos/                     # Brand assets (SVG)
├── index.html                     # HTML shell with meta tags
├── netlify.toml                   # Build + function config, CORS headers
├── vite.config.js                 # Vite config with dev proxy
├── package.json                   # Dependencies and scripts
├── .env.example                   # Required environment variables
├── .nvmrc                         # Node 18 version pin
├── .prettierrc                    # Code formatting
└── .eslintrc.json                 # Linting rules
```

## Getting Started

### Prerequisites

- **Node.js 18+** (see `.nvmrc`)
- **npm 9+**
- **Netlify CLI**: `npm i -g netlify-cli`
- **API Keys**: Apollo.io, Anthropic, Hunter.io (optional but recommended)

### Installation

```bash
git clone https://github.com/your-org/mantyl-sequence-generator.git
cd mantyl-sequence-generator
npm install
cp .env.example .env
```

Edit `.env` with your API credentials (see [Environment Variables](#environment-variables)).

### Local Development

```bash
npx netlify dev
```

Runs the Vite dev server on port 5173 with Netlify Functions proxied through port 8888. All `/.netlify/functions/*` requests route to the local function runtime.

### Production Build

```bash
npm run build
```

Output: `dist/`. Netlify executes this automatically on every deploy.

## Deployment

### Netlify (Recommended)

1. Push to GitHub
2. Import in Netlify Dashboard → **"Import an existing project"**
3. Build settings auto-detected from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. Configure environment variables in **Site Settings → Environment Variables**
5. Deploy

### Custom Domain

Add `tools.yourdomain.com` as a custom domain in Netlify → Domain settings. Automatic SSL provisioning via Let's Encrypt.

## Environment Variables

| Variable | Required | Description | Where to Get It |
|----------|----------|-------------|-----------------|
| `APOLLO_API_KEY` | **Yes** | Prospect search and enrichment | [Apollo Settings → API](https://app.apollo.io/#/settings/integrations/api) |
| `ANTHROPIC_API_KEY` | **Yes** | Sequence copy generation (Claude) | [Anthropic Console → API Keys](https://console.anthropic.com/settings/keys) |
| `HUNTER_API_KEY` | Recommended | Email gap-fill and verification | [Hunter.io → API](https://hunter.io/api-keys) |

**Without `HUNTER_API_KEY`:** The system still works. Apollo handles primary enrichment. Pattern guessing runs without verification (lower confidence emails). Adding Hunter significantly improves email deliverability.

## API Integration Details

### Apollo.io (`find-prospects.js`)

- **Search**: `POST /v1/mixed_people/search` with organization and person filters
- **Enrich**: `POST /v1/people/match` for individual contact enrichment
- **Phone Webhook**: Apollo delivers phone numbers asynchronously via webhook; the app polls `/phone-webhook/:sessionId` every 5 seconds for up to 2 minutes
- **Filters**: Industry, employee count range, job titles (array), geography, technology tags, keyword criteria

### Hunter.io (`find-prospects.js` — Step 3)

- **Email Finder**: `GET /v2/email-finder?domain=X&first_name=Y&last_name=Z`
- **Email Verifier**: `GET /v2/email-verifier?email=X` — returns `valid`, `invalid`, `accept_all`, or `unknown`
- **Rate handling**: Stops on 429 (rate limit) or 402 (quota exhausted), gracefully skips remaining
- **Scoring**: Emails with Hunter confidence score ≥80 marked `hunter_verified`; 50–79 marked `hunter_guessed`

### Anthropic Claude (`generate-sequence.js`)

- **Model**: `claude-sonnet-4-5-20250929`
- **System prompt**: Includes tone instructions, sender sign-off, product context, channel-specific formatting rules
- **Output**: Structured JSON with touchpoint array (day, channel, subject, body)
- **Rate limiting**: Adaptive parallel → sequential fallback with 60s cooldown on 429

## Email Validation Badges

The prospect table displays verification status for each email:

| Badge | Meaning | Source |
|-------|---------|--------|
| ✓ (green) | Verified deliverable | Apollo verified or Hunter `valid` |
| ~ (yellow) | Likely valid, unverified | Hunter guessed (score 50–79) or pattern-inferred |
| ? (gray) | Unknown status | Email present but no verification data |

## Cost Estimates

| Service | Pricing Model | Per-Run Estimate (10 prospects) |
|---------|--------------|-------------------------------|
| Apollo.io | Credit-based (search + enrich) | ~20 credits |
| Hunter.io | 25 free lookups/month, then $34/month | 0–10 lookups |
| Anthropic Claude | Input/output tokens | ~$0.15–0.30 |

Hard cap of 20 prospects per run for cost control. The adaptive rate limiter ensures completion within any API tier's rate window.

## Key Features

- **156 industries** across 14 categories (Apollo taxonomy)
- **11 company size intervals** with automatic segment mapping (SMB / Midmarket / Enterprise)
- **3 tone options**: Professional, Casual, Simple
- **Auto vs. Manual** email send types with distinct copy styles
- **Sender profile** threaded through all generated copy (name, title, Calendly, LinkedIn)
- **CSV export** for prospect data + sequences
- **Real-time progress** — prospect table populates before sequence generation begins
- **Phone polling** — direct dials and mobile numbers stream in asynchronously
- **Usage tracking** with CTA gating after 3 uses

## Security Considerations

- All API keys are server-side only (Netlify Functions). No secrets reach the client.
- CORS headers configured in `netlify.toml` — restrict `Access-Control-Allow-Origin` to your domain in production.
- Phone webhook data stored in `/tmp/` (ephemeral, cleared on function cold start). No persistent PII storage.
- No database. No user accounts. Stateless architecture.

## License

Proprietary — [mantyl.ai](https://mantyl.ai). All rights reserved.

See [LICENSE](./LICENSE) for full terms.

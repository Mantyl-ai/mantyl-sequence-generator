# ICP-to-Sequence Generator

> AI-powered outbound sales tool that finds prospects matching your Ideal Customer Profile and generates personalized multi-channel sequences.

Built by [mantyl.ai](https://mantyl.ai) — AI-Powered GTM Automation.

---

## Overview

This is a full-stack web application that automates the two hardest parts of outbound sales: finding the right people and writing personalized copy at scale.

**What it does:**

1. Takes your ICP parameters (industry, segment, job titles, geography, etc.)
2. Searches and enriches matching prospects via Clay API
3. Generates a complete multi-channel outbound sequence (email, LinkedIn, calling) for each prospect via Claude API
4. Outputs personalized, ready-to-use copy with your sender profile baked in

**Key features:**

- 156 industries across 14 categories (Apollo-style taxonomy)
- 11 granular company size intervals with segment mapping (SMB / Midmarket / Enterprise)
- 3 tone options: Professional, Casual, Simple
- Auto vs Manual email send type with distinct copy styles
- Sender profile sign-off threaded through all generated copy
- Product description and messaging context for relevant personalization
- CSV export for prospect data + sequences
- Usage tracking with CTA gating after 3 uses
- Hard cap at 20 prospects per run for cost control

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    React + Vite                       │
│              (Single Page Application)                │
│                                                       │
│  ICPForm → MantylLoader → ProspectList + SequenceCopy│
└──────────────────┬──────────────────┬────────────────┘
                   │                  │
            /.netlify/functions  /.netlify/functions
                   │                  │
     ┌─────────────▼──┐    ┌─────────▼──────────┐
     │ find-prospects  │    │ generate-sequence   │
     │  (Clay API)     │    │  (Anthropic API)    │
     └────────────────┘    └────────────────────┘
```

| Layer | Tech | Purpose |
|-------|------|---------|
| Frontend | React 18, Vite 6 | SPA with form, results, loading states |
| Backend | Netlify Functions (serverless) | Two API routes, no server to manage |
| Prospect Data | Clay API | Search, filter, and enrich B2B contacts |
| Copy Generation | Claude API (claude-sonnet-4-5-20250929) | Personalized sequence copy per prospect |
| Styling | Custom CSS (1,400+ lines) | Mantyl brand system, fully responsive |
| Deployment | Netlify | Single-repo deploy with functions |

## Project Structure

```
sequence-generator/
├── src/
│   ├── components/
│   │   ├── ICPForm.jsx            # Form with ICP params, sender profile, sequence settings
│   │   ├── ProspectList.jsx       # Full-width prospect table with enrichment status
│   │   ├── SequenceCopy.jsx       # Touchpoint cards with copy/paste and prospect selector
│   │   └── MantylLoader.jsx       # Branded loading animation (sail SVGs, orbit dots)
│   ├── utils/
│   │   ├── apiClient.js           # Fetch wrapper for Netlify Functions
│   │   └── csvExport.js           # CSV download utility
│   ├── App.jsx                    # Root component, state management, usage tracking
│   ├── main.jsx                   # Entry point
│   └── index.css                  # Complete Mantyl design system
├── netlify/
│   └── functions/
│       ├── find-prospects.js      # Clay API integration with fallback strategies
│       └── generate-sequence.js   # Claude API with tone, product context, sender sign-off
├── public/
│   ├── logos/                     # Brand logo assets
│   └── mantyl-favicon-32.png     # Favicon
├── index.html                     # HTML shell with meta tags and Inter font
├── netlify.toml                   # Build config, functions directory, CORS headers
├── vite.config.js                 # Vite config with dev proxy
├── package.json                   # Dependencies and scripts
├── .env.example                   # Required environment variables
├── .gitignore                     # Git exclusions
├── .nvmrc                         # Node version pin
├── .prettierrc                    # Code formatting rules
└── .eslintrc.json                 # Linting configuration
```

## Getting Started

### Prerequisites

- Node.js 18+ (see `.nvmrc`)
- npm 9+
- [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`npm i -g netlify-cli`)
- API keys for Clay and Anthropic

### Installation

```bash
# Clone the repo
git clone https://github.com/your-org/mantyl-sequence-generator.git
cd mantyl-sequence-generator

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Then fill in your CLAY_API_KEY and ANTHROPIC_API_KEY
```

### Local Development

```bash
# Start Vite dev server + Netlify Functions (port 8888)
npx netlify dev
```

This runs the full stack locally. The Vite dev server proxies `/.netlify/functions/*` requests to the local Netlify Functions runtime.

### Build

```bash
npm run build
```

Output goes to `dist/`. Netlify runs this automatically on deploy.

## Deployment

### Netlify (recommended)

1. Push to GitHub
2. Connect repo in Netlify dashboard → "Import an existing project"
3. Build settings are auto-detected from `netlify.toml`:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Functions directory:** `netlify/functions`
4. Add environment variables in **Site Settings → Environment Variables**:

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `CLAY_API_KEY` | Yes | [clay.com → Settings → API](https://app.clay.com/settings/api) |
| `ANTHROPIC_API_KEY` | Yes | [console.anthropic.com → API Keys](https://console.anthropic.com/settings/keys) |

5. Deploy. That's it.

### Custom Domain

To serve at `tools.mantyl.ai` or a subpath of your main site:

- **Subdomain:** Add `tools.mantyl.ai` as a custom domain in Netlify → Domain settings
- **Iframe embed:** Deploy as a separate Netlify site and embed:
  ```html
  <iframe src="https://tools.mantyl.ai" width="100%" height="900" frameborder="0"></iframe>
  ```

## API Integration Details

### Clay API (`find-prospects.js`)

- Endpoint: `POST /v3/sources/search-people` with fallback to `/v3/run-table`
- Filters: industry, company size (min/max employees), job titles, geography, tech stack
- Response normalized across multiple Clay response formats
- Enrichment status derived from available data (email, phone, LinkedIn)

### Claude API (`generate-sequence.js`)

- Model: `claude-sonnet-4-5-20250929`
- System prompt includes: tone instructions, sender sign-off, product context, no-dashes formatting rule, auto/manual send type guidance
- Prospects batched in groups of 5 to avoid rate limits
- Structured JSON output parsed from Claude response
- Graceful fallback with error message if generation fails for a prospect

### Sequence Logic

Each sequence follows an **Opening → Value Add → Closing** arc:

| Position | Stage | Purpose |
|----------|-------|---------|
| First 30% | Opening | Introduce, reference prospect's role/company, spark curiosity |
| Middle 40% | Value Add | Share insights, case studies, industry trends — no hard sell |
| Final 30% | Closing | Specific ask (demo/call/meeting), create urgency |

Channel assignment rotates through selected channels. First touchpoint is always email. Last touchpoint defaults to calling if enabled.

## Cost Considerations

| Service | Pricing Model | Per-Run Estimate (10 prospects) |
|---------|--------------|-------------------------------|
| Clay | Per enrichment credit | ~10 credits |
| Claude | Per input/output token | ~$0.15–0.30 |

Hard cap of 20 prospects per run to keep costs predictable.

## License

Proprietary — mantyl.ai. All rights reserved.

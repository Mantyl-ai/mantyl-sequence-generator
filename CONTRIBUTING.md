# Contributing

Thank you for your interest in contributing to the Mantyl Sequence Generator. This document outlines the development workflow, standards, and conventions used across the project.

## Development Setup

1. **Clone and install:**
   ```bash
   git clone https://github.com/your-org/mantyl-sequence-generator.git
   cd mantyl-sequence-generator
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Fill in your API keys. At minimum, you need `APOLLO_API_KEY` and `ANTHROPIC_API_KEY`. See `.env.example` for details.

3. **Start the development server:**
   ```bash
   npx netlify dev
   ```
   This runs Vite (port 5173) behind the Netlify dev proxy (port 8888), which enables local execution of serverless functions at `/.netlify/functions/*`.

4. **Verify setup:**
   - Navigate to `http://localhost:8888`
   - Fill in ICP parameters and run a small test (2–3 prospects)
   - Confirm prospect enrichment and sequence generation both succeed

## Code Standards

### Formatting and Linting

- **Prettier** for formatting (config in `.prettierrc`)
- **ESLint** for linting (config in `.eslintrc.json`)
- Run both before committing. CI will enforce these.

### JavaScript / React

- **Functional components only** — no class components
- **Hooks** for all state and side-effect management
- **Named exports** for utilities, **default exports** for components
- **No TypeScript** currently — but all function signatures should be documented with JSDoc comments in serverless functions

### CSS

- All styles live in `src/index.css`
- Uses **CSS custom properties** (design tokens) defined at `:root`
- Follow the existing naming convention: `.component-name`, `.component-name-modifier`
- No CSS modules, no Tailwind, no CSS-in-JS

### Serverless Functions

- Each function in `netlify/functions/` is a self-contained module
- Use the `respond(statusCode, body)` helper for consistent CORS headers
- Log enrichment pipeline steps with `console.log('[Step Name] ...')` for debugging
- Handle API rate limits gracefully — never let a 429 crash the function

## Branch Naming

| Prefix | Use |
|--------|-----|
| `feature/` | New features or capabilities |
| `fix/` | Bug fixes |
| `refactor/` | Code improvements with no behavior change |
| `docs/` | Documentation updates |
| `chore/` | Build, config, or dependency changes |

Examples: `feature/add-linkedin-enrichment`, `fix/hunter-badge-display`, `docs/update-architecture`

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Hunter.io email gap-fill to enrichment pipeline
fix: resolve pattern guessing skip on missing companyDomain
refactor: extract email pattern detection into utility
docs: update README with waterfall enrichment architecture
chore: remove deprecated Clay webhook function
```

Scope is optional but encouraged for larger changes: `feat(enrichment): add domain inference from company name`

## Pull Requests

- **One concern per PR** — avoid mixing features, fixes, and refactors
- **Title**: Brief, imperative description (e.g., "Add Hunter.io fallback for email enrichment")
- **Description**: Include what changed, why, and how to test it
- **Test locally** with `npx netlify dev` before submitting — run at least one full ICP search to verify the enrichment pipeline

## Architecture Decisions

Major changes to the enrichment pipeline, API integrations, or frontend architecture should be discussed in an issue before implementation. See [ARCHITECTURE.md](./ARCHITECTURE.md) for a technical overview of the system design.

## Environment and API Key Safety

- **Never commit `.env`** — it is in `.gitignore`
- **Never log API keys** — even in debug output
- **Never expose keys client-side** — all API calls happen in Netlify Functions (server-side only)
- If you add a new API integration, update `.env.example` with the new variable and document it in the README

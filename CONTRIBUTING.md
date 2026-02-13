# Contributing

## Development Setup

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and add your API keys.

3. Run the dev server:
   ```bash
   npx netlify dev
   ```

## Code Style

- **Formatting:** Prettier (see `.prettierrc`)
- **Linting:** ESLint (see `.eslintrc.json`)
- **CSS:** All styles live in `src/index.css` using CSS custom properties (Mantyl brand tokens)
- **Components:** Functional React components with hooks. No class components.

## Branch Naming

- `feature/short-description` — New features
- `fix/short-description` — Bug fixes
- `refactor/short-description` — Code improvements

## Commit Messages

Use conventional commits:

```
feat: add geography filter to ICP form
fix: handle Clay API timeout gracefully
refactor: extract sender sign-off into utility
```

## Pull Requests

- Keep PRs focused on a single change
- Include a clear description of what changed and why
- Test locally with `npx netlify dev` before submitting

/**
 * Pre-commit lint and format of staged files only (#113).
 * Type-aware ESLint runs on staged TypeScript; Prettier on everything it knows.
 */
const config = {
  "*.{ts,tsx,mts,mjs}": ["eslint --fix --max-warnings=100", "prettier --write"],
  "*.{json,md,yml,yaml,css}": ["prettier --write"],
};

export default config;

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Next's own rules (React, hooks, accessibility, Core Web Vitals) plus its TypeScript rules. Scripts and tests are plain Node files, not part of the site.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', '.screens/**', 'scripts/**', 'tests/**', 'next-env.d.ts']),
]);

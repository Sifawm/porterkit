import nx from '@nx/eslint-plugin';
import jsonc from 'jsonc-eslint-parser';

// ESLint runs one rule: the hand-written dependencies of the published packages match their imports.
export default [
  {
    files: ['packages/*/package.json'],
    languageOptions: { parser: jsonc },
    plugins: { '@nx': nx },
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/vitest.config.{ts,mts}',
            '{projectRoot}/src/**/*.test{,-d}.{ts,tsx}',
            '{projectRoot}/src/{testing,test-setup}.ts',
          ],
        },
      ],
    },
  },
];

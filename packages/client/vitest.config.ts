import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    typecheck: { enabled: true, tsconfig: './tsconfig.spec.json', include: ['src/**/*.test-d.ts'] },
  },
});

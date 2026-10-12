import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    typecheck: { enabled: true, tsconfig: './tsconfig.spec.json', include: ['src/**/*.test-d.ts'] },
  },
});

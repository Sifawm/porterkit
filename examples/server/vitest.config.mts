import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Oxc does not emit decorator metadata; SWC takes over the transform.
  oxc: false,
  plugins: [
    swc.vite({
      tsconfigFile: false,
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
      module: { type: 'es6' },
    }),
  ],
  test: { include: ['src/**/*.test.ts'] },
});

import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection, z } from 'astro:content';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        /** What the page covers, as paths from the repository root: `docs/spec/nestjs.md#ticks`, `CONTEXT.md`. */
        spec: z.array(z.string()).optional(),
      }),
    }),
  }),
};

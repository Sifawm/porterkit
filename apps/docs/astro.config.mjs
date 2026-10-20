import { fileURLToPath } from 'node:url';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

const packages = ['contracts', 'nestjs', 'client', 'react', 'godot'];

export default defineConfig({
  site: 'https://sifawm.github.io',
  base: '/porterkit',
  integrations: [
    starlight({
      title: 'Porter',
      description: 'Real-time rooms for NestJS, React and Godot.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Sifawm/porterkit' }],
      editLink: { baseUrl: 'https://github.com/Sifawm/porterkit/edit/main/apps/docs/' },
      plugins: [
        starlightLinksValidator(),
        starlightTypeDoc({
          entryPoints: packages.map((name) => `../../packages/${name}`),
          tsconfig: './tsconfig.typedoc.json',
          output: 'reference/api',
          sidebar: { label: 'API', collapsed: true },
          typeDoc: {
            entryPointStrategy: 'packages',
            packageOptions: {
              entryPoints: ['src/index.ts'],
              validation: { notExported: false },
              tsconfig: fileURLToPath(new URL('tsconfig.typedoc.json', import.meta.url)),
            },
            readme: './api-readme.md',
            excludePrivate: true,
            excludeInternal: true,
          },
        }),
      ],
      sidebar: [
        { label: 'Start', items: [{ autogenerate: { directory: 'start' } }] },
        {
          label: 'Guides',
          items: [
            { label: 'Games', items: [{ autogenerate: { directory: 'guides/game' } }] },
            { label: 'Manager', items: [{ autogenerate: { directory: 'guides/manager' } }] },
            { label: 'Client', items: [{ autogenerate: { directory: 'guides/client' } }] },
            { label: 'React', items: [{ autogenerate: { directory: 'guides/react' } }] },
            { label: 'Godot', items: [{ autogenerate: { directory: 'guides/godot' } }] },
            { label: 'Rooms', items: [{ autogenerate: { directory: 'guides/rooms' } }] },
            { label: 'Testing', items: [{ autogenerate: { directory: 'guides/testing' } }] },
          ],
        },
        { label: 'Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }, typeDocSidebarGroup],
        },
      ],
    }),
  ],
});

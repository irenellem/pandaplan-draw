import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Served by the same nginx container as the app, at https://draw.pandaplan.work/manual/.
// The build lands inside the app's public/ tree so one image ships both.
export default defineConfig({
  site: 'https://draw.pandaplan.work',
  base: '/manual',
  outDir: '../public/manual',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'PandaPlan Draw',
      description: 'How to draw, save, rename, duplicate and print diagrams in PandaPlan Draw.',
      logo: { src: './src/assets/logo.png', alt: 'Dairy Technologies Corporation' },
      favicon: '/manual/favicon.svg',
      customCss: ['./src/styles/manual.css'],
      pagefind: true,
      sidebar: [],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      pagination: false,
      credits: false,
      social: [{ icon: 'left-arrow', label: 'Back to Draw', href: 'https://draw.pandaplan.work/' }],
      head: [
        // The app's own type scale and link colour, so the manual reads as one product.
        { tag: 'meta', attrs: { name: 'color-scheme', content: 'light dark' } },
      ],
    }),
  ],
});

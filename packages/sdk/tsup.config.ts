import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    signing: 'src/signing/index.ts',
    embed: 'src/embed/index.ts',
    sheets: 'src/sheets/index.ts',
    styles: 'src/styles.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [
    'react',
    'react-dom',
    // Univer is peer; consumers install the matching @univerjs/* set.
    /^@univerjs\//,
  ],
});

import { defineConfig } from 'tsup';
import pkg from './package.json';

const versionDefine = { 'process.env.APP_VERSION': JSON.stringify(pkg.version) };

export default defineConfig([
  // Library build (existing, unchanged)
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node18',
    define: versionDefine,
  },
  // CLI build (ESM required — ink v5 is ESM-only)
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    target: 'node18',
    define: versionDefine,
    external: [
      'ai',
      '@ai-sdk/openai',
      '@ai-sdk/anthropic',
      '@ai-sdk/azure',
      'ink',
      'react',
      'commander',
      'dotenv',
      'zod',
    ],
  },
]);

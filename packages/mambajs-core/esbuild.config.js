import esbuild from 'esbuild';
import inlineWorkerPlugin from 'esbuild-plugin-inline-worker';

import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";

import path from 'path';
import fs from 'fs';

(async () => {
  try {
    await esbuild
      .build({
        entryPoints: ['./src/index.ts'],
        bundle: true,
        outdir: './lib',
        format: 'esm',
        loader: {
          '.wasm': 'file'
        },
        plugins: [
          inlineWorkerPlugin(),
          NodeModulesPolyfillPlugin(),
          NodeGlobalsPolyfillPlugin({
            buffer: true,
            process: true,
          }),
        ],
      });
    console.log('Build succeeded!');
  } catch (err) {
    console.error('Build failed:', err.message);
  }
})();
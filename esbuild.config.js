const esbuild = require('esbuild');

const { NodeModulesPolyfillPlugin } = require("@esbuild-plugins/node-modules-polyfill");
const { NodeGlobalsPolyfillPlugin } = require("@esbuild-plugins/node-globals-polyfill");

const path = require('path');
const fs = require('fs');

(async () => {
  try {
    await esbuild
  .build({
    entryPoints: ['./src/index.ts'],
    bundle: true,
    outdir: './lib',
    loader: {
      '.wasm': 'base64'
    },
    plugins: [
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

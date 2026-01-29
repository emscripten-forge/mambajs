const esbuild = require("esbuild");

(async () => {
  try {
    await esbuild.build({
      entryPoints: ["./src/index.ts"],
      bundle: true,

      tsconfig: "./tsconfig.json",

      // Node CLI target
      platform: "node",
      target: "node18",

      // Output
      outdir: "./dist",
      format: "esm",

      // Keep CLI runnable
      banner: {
        js: "#!/usr/bin/env node"
      },

      external: [
        "fs",
        "path",
        "os",
        "child_process",
        "crypto"
      ],

      sourcemap: false,
      minify: false,

      logLevel: "info",
    });
  } catch (err) {
    process.exit(1);
  }
})();

import { readFileSync, writeFileSync } from "fs";
import process from "process";

import { Platform } from '@conda-org/rattler';

import { computeLockId } from "@emscripten-forge/mambajs-core";
import { create } from "@emscripten-forge/mambajs";


async function main() {
  const [, , command, envPath, outputPath, platform] = process.argv;

  let targetPlatform = platform as Platform | undefined;

  if (command !== "create-lock" || !envPath || !outputPath) {
    console.error("Usage: mambajs create-lock environment.yml lock.json");
    process.exit(1);
  }

  if (!targetPlatform) {
    targetPlatform = 'emscripten-wasm32';
  }

  const environmentYml = readFileSync(envPath, "utf8");

  console.log("Solving environment...");

  const lock = await create({
    yml: environmentYml,
    logger: console,
    platform: targetPlatform
  });

  lock.id = computeLockId(environmentYml);

  writeFileSync(outputPath, JSON.stringify(lock, null, 2));

  console.log(`Lockfile successfully written to ${outputPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

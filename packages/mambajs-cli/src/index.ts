import { readFileSync, writeFileSync } from "fs";
import { Command } from "commander";

import { Platform } from "@conda-org/rattler";
import { computeLockId } from "@emscripten-forge/mambajs-core";
import { create } from "@emscripten-forge/mambajs";

import * as packageJSON from '../package.json';

const program = new Command();

program
  .name("mambajs")
  .description(packageJSON.description)
  .version(packageJSON.version);

program
  .command("create-lock")
  .description("Create a lock.json from an environment.yml")
  .argument("<env>", "Path to environment.yml")
  .argument("<output>", "Path to output lock.json")
  .option(
    "-p, --platform <platform>",
    "Target platform",
    "emscripten-wasm32"
  )
  .action(async (envPath, outputPath, options) => {
    const targetPlatform = options.platform as Platform;

    const environmentYml = readFileSync(envPath, "utf8");

    console.log("Solving environment...");

    const lock = await create({
      yml: environmentYml,
      logger: console,
      platform: targetPlatform,
    });

    lock.id = computeLockId(environmentYml);

    writeFileSync(outputPath, JSON.stringify(lock, null, 2));

    console.log(`Lockfile successfully written to ${outputPath}`);
  });

program.parse();

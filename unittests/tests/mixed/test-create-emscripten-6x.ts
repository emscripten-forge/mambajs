import { create, install, ISolvedPackage } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';
import { Platform } from '@conda-org/rattler';

const logger = new TestLogger();

const yml = `
channels:
  - https://prefix.dev/emscripten-forge/6x
  - conda-forge
dependencies:
  - python
  - numpy
`;

// Each platform is chained onto the previous one so that their logs do not interleave
let tests = Promise.resolve();
// An undefined platform should default to emscripten-wasm32
([undefined, 'emscripten-wasm32', 'emscripten-wasm64'] as (Platform | undefined)[]).forEach(platform => {
  tests = tests.then(async () => {
    const expectedPlatform = platform ?? 'emscripten-wasm32';
    let env = await create({yml, logger, platform});

    // Index by package name for convenienve
    let condaPackages: { [key: string]: ISolvedPackage } = {};
    Object.keys(env.packages).map(filename => {
      condaPackages[env.packages[filename].name] =
        env.packages[filename];
    });

    expect(env.platform).toEqual(expectedPlatform);

    expect(condaPackages['emscripten-abi'].version[0]).toEqual('6');
    expect(condaPackages['numpy'].subdir).toEqual(expectedPlatform);

    // Platform must be taken from the existing lock
    env = await install(['pandas'], env);

    // Index by package name for convenienve
    condaPackages = {};
    Object.keys(env.packages).map(filename => {
      condaPackages[env.packages[filename].name] =
        env.packages[filename];
    });

    expect(env.platform).toEqual(expectedPlatform);
    expect(condaPackages['pandas'].subdir).toEqual(expectedPlatform);

    // Make sure channels haven't changed
    expect(env.channels).toEqual(['https://prefix.dev/emscripten-forge/6x', 'conda-forge']);

    // Make sure we keep the emscripten version
    expect(condaPackages['emscripten-abi'].version[0]).toEqual('6');
  });
});

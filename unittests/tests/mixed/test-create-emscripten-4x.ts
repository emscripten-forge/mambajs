import { create, install, ISolvedPackage, ISolvedPipPackage } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
channels:
  - https://repo.prefix.dev/emscripten-forge-4x
  - conda-forge
dependencies:
  - pandas
  - xeus-python
`;

create({yml, logger}).then(async env => {
  // Index by package name for convenienve
  let condaPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(env.packages).map(filename => {
    condaPackages[env.packages[filename].name] =
      env.packages[filename];
  });
  const pipPackages: { [key: string]: ISolvedPipPackage } = {};
  Object.keys(env.pipPackages).map(filename => {
    pipPackages[env.pipPackages[filename].name] =
      env.pipPackages[filename];
  });

  expect(env.platform).toEqual('emscripten-wasm32');

  expect(condaPackages['emscripten-abi'].version[0]).toEqual('4');

  env = await install(['ipycanvas=0.13.2'], env);

  // Index by package name for convenienve
  condaPackages = {};
  Object.keys(env.packages).map(filename => {
    condaPackages[env.packages[filename].name] =
      env.packages[filename];
  });

  expect(condaPackages['ipycanvas'].version).toEqual('0.13.2');

  // Make sure channels haven't changed
  expect(env.channels).toEqual(['emscripten-forge-4x', 'conda-forge']);

  // Make sure we keep the emscripten version
  expect(condaPackages['emscripten-abi'].version[0]).toEqual('4');
});

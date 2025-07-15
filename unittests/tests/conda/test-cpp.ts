import { ISolvedPackage, solve } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
channels:
  - https://prefix.dev/emscripten-forge-dev
  - https://prefix.dev/conda-forge
dependencies:
  - xeus-cpp
`;

solve({ymlOrSpecs: yml, logger}).then(async result => {
  const packageNames = Object.values(result.condaPackages).map(pkg => pkg.name);

  // Index by package name for convenienve
  const condaPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(result.condaPackages).map(filename => {
    condaPackages[result.condaPackages[filename].name] =
      result.condaPackages[filename];
  });

  expect(packageNames).toInclude('xeus-cpp');
});

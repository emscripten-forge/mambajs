import { ISolvedPackage, solve } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

let yml = `
channels:
  - https://prefix.dev/emscripten-forge-dev
  - https://prefix.dev/conda-forge
dependencies:
  # click requires __unix
  - click>=8.3.1
`;

solve({ymlOrSpecs: yml, logger}).then(async result => {
  const packageNames = Object.values(result.packages).map(pkg => pkg.name);

  // Index by package name for convenienve
  const condaPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(result.packages).map(filename => {
    condaPackages[result.packages[filename].name] =
      result.packages[filename];
  });

  expect(packageNames).toInclude('click');
});

yml = `
channels:
  - https://prefix.dev/emscripten-forge-4x
  - https://prefix.dev/conda-forge
dependencies:
  # click requires __unix
  - click>=8.3.1
`;

solve({ymlOrSpecs: yml, logger}).then(async result => {
  const packageNames = Object.values(result.packages).map(pkg => pkg.name);

  // Index by package name for convenienve
  const condaPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(result.packages).map(filename => {
    condaPackages[result.packages[filename].name] =
      result.packages[filename];
  });

  expect(packageNames).toInclude('click');
});

yml = `
channels:
  - https://prefix.dev/conda-forge
dependencies:
  # click requires __unix
  - click>=8.3.1
`;

solve({ymlOrSpecs: yml, logger, platform: "linux-64"}).then(async result => {
  const packageNames = Object.values(result.packages).map(pkg => pkg.name);

  // Index by package name for convenienve
  const condaPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(result.packages).map(filename => {
    condaPackages[result.packages[filename].name] =
      result.packages[filename];
  });

  expect(packageNames).toInclude('click');
});

yml = `
channels:
  - https://prefix.dev/conda-forge
dependencies:
  # oracle-instant-client requires __glibc
  - oracle-instant-client
`;

solve({ymlOrSpecs: yml, logger, platform: "linux-64"}).then(async result => {
  const packageNames = Object.values(result.packages).map(pkg => pkg.name);

  // Index by package name for convenienve
  const condaPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(result.packages).map(filename => {
    condaPackages[result.packages[filename].name] =
      result.packages[filename];
  });

  expect(packageNames).toInclude('oracle-instant-client');
});


import { create, ISolvedPackage, ISolvedPipPackage } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

let yml = `
channels:
  - https://repo.prefix.dev/emscripten-forge-4x
  - https://repo.prefix.dev/conda-forge
dependencies:
  - xeus-python
  - numpy
  - pip:
    - contourpy
`;

create({yml, logger}).then(async result => {
  const condaPackageNames = Object.values(result.packages).map(pkg => pkg.name);
  const pipPackageNames = Object.values(result.pipPackages).map(pkg => pkg.name);

  // Index by package name for convenienve
  const condaPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(result.packages).map(filename => {
    condaPackages[result.packages[filename].name] =
      result.packages[filename];
  });
  const pipPackages: { [key: string]: ISolvedPipPackage } = {};
  Object.keys(result.pipPackages).map(filename => {
    pipPackages[result.pipPackages[filename].name] =
      result.pipPackages[filename];
  });

  expect(condaPackageNames).toInclude('xeus-python', 'numpy');
  expect(pipPackageNames).toInclude('contourpy');
});

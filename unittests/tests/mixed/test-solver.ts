import { ISolvedPackage, solve } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
channels:
  - https://prefix.dev/emscripten-forge-dev
  - https://prefix.dev/conda-forge
dependencies:
  - pandas
  - xeus-python
  - ipycanvas=0.13.2
  - pip:
    - ipydatagrid
    - bqplot ==0.12.42
`;

solve({ymlOrSpecs: yml, logger}).then(async result => {
  const condaPackageNames = Object.values(result.condaPackages).map(pkg => pkg.name);
  const pipPackageNames = Object.values(result.pipPackages).map(pkg => pkg.name);

  // Index by package name for convenienve
  const condaPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(result.condaPackages).map(filename => {
    condaPackages[result.condaPackages[filename].name] =
      result.condaPackages[filename];
  });
  const pipPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(result.pipPackages).map(filename => {
    pipPackages[result.pipPackages[filename].name] =
      result.pipPackages[filename];
  });

  expect(condaPackageNames).toInclude('xeus-python', 'xeus-python-shell', 'pandas', 'ipycanvas', 'ipywidgets');
  expect(pipPackageNames).toInclude('bqplot', 'ipydatagrid');

  expect(condaPackages['ipycanvas'].version).toEqual('0.13.2');
  expect(pipPackages['bqplot'].version).toEqual('0.12.42');
});

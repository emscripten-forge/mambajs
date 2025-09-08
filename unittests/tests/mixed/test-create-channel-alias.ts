import { create, ISolvedPackage, ISolvedPipPackage } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
channels:
  - emscripten-forge
  - conda-forge
dependencies:
  - pandas
  - xeus-python
  - ipycanvas=0.13.2
  - pip:
    - ipydatagrid
    - bqplot ==0.12.42
`;

create(yml, logger).then(async result => {
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

  expect(condaPackageNames).toInclude('xeus-python', 'xeus-python-shell', 'pandas', 'ipycanvas', 'ipywidgets');
  expect(pipPackageNames).toInclude('bqplot', 'ipydatagrid');

  expect(condaPackages['ipycanvas'].version).toEqual('0.13.2');
  expect(pipPackages['bqplot'].version).toEqual('0.12.42');
});

import { create, ISolvedPackage, ISolvedPipPackage } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
channels:
  - https://prefix.dev/conda-forge
dependencies:
  - pandas
  - xeus-python
  - ipycanvas=0.13.2
`;

create({yml, logger, platform: "linux-64"}).then(async result => {
  const condaPackageNames = Object.values(result.packages).map(pkg => pkg.name);

  // Index by package name for convenience
  const condaPackages: { [key: string]: ISolvedPackage } = {};
  Object.keys(result.packages).map(filename => {
    condaPackages[result.packages[filename].name] =
      result.packages[filename];
  });

  expect(result.platform).toEqual('linux-64');

  expect(condaPackageNames).toInclude('xeus-python', 'xeus-python-shell', 'pandas', 'ipycanvas', 'ipywidgets');

  expect(condaPackages['ipycanvas'].version).toEqual('0.13.2');
});

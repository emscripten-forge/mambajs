import { create, install, pipUninstall, remove } from "../../../packages/mambajs/src";
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
  - ipycanvas
  - pip:
    - ipydatagrid
`;

create(yml, logger).then(async env => {
  env = await install(['ipycanvas=0.13.2', 'bqplot<1'], env);

  let condaPackageNames = Object.values(env.packages.condaPackages).map(pkg => pkg.name);
  let pipPackageNames = Object.values(env.packages.pipPackages).map(pkg => pkg.name);

  expect(condaPackageNames).toInclude('bqplot', 'ipycanvas');
  expect(pipPackageNames).toInclude('ipydatagrid');

  env = await remove(['ipycanvas', 'bqplot'], env, logger);

  // specs are removed
  expect(env.specs).not.toInclude('ipycanvas=0.13.2', 'ipycanvas', 'bqplot<1');
  expect(env.specs).toEqualUnsorted(['pandas', 'xeus-python'])

  condaPackageNames = Object.values(env.packages.condaPackages).map(pkg => pkg.name);
  pipPackageNames = Object.values(env.packages.pipPackages).map(pkg => pkg.name);

  expect(condaPackageNames).not.toInclude('ipycanvas', 'bqplot');
  expect(pipPackageNames).toInclude('ipydatagrid');

  env = await pipUninstall(['ipydatagrid'], env, logger);

  pipPackageNames = Object.values(env.packages.pipPackages).map(pkg => pkg.name);

  expect(pipPackageNames).not.toInclude('ipydatagrid');
});

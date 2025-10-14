import { computeCondaPackagesDiff, computePipPackagesDiff, create, install, pipUninstall, remove } from "../../../packages/mambajs/src";
import { ILock } from '../../../packages/mambajs-core/src';
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

create({yml, logger}).then(async env => {
  let oldLock = env;
  let newLock: ILock;

  env = await install(['ipycanvas=0.13.2', 'bqplot<1'], env, [], logger);

  // Test diff helper function
  newLock = env;
  let pipDiff = computePipPackagesDiff({ oldLock, newLock });
  let condaDiff = computeCondaPackagesDiff({ oldLock, newLock });
  expect(Object.keys(pipDiff.newPackages)).toBeEmpty();
  expect(Object.keys(pipDiff.removedPackages).length).toBeGreaterThanOrEqual(2) // at least traittypes and bqplot are now coming from conda;
  expect(Object.keys(condaDiff.newPackages).length).toBeGreaterThanOrEqual(2); // at least ipycanvas and bqplot new versions
  expect(Object.keys(condaDiff.removedPackages).length).toEqual(1); // ipycanvas old version

  let condaPackageNames = Object.values(env.packages).map(pkg => pkg.name);
  let pipPackageNames = Object.values(env.pipPackages).map(pkg => pkg.name);

  expect(condaPackageNames).toInclude('bqplot', 'ipycanvas');
  expect(pipPackageNames).toInclude('ipydatagrid');

  oldLock = env;
  env = await remove(['ipycanvas', 'bqplot'], env, logger);
  newLock = env;

  // Test diff helper function
  pipDiff = computePipPackagesDiff({ oldLock, newLock });
  condaDiff = computeCondaPackagesDiff({ oldLock, newLock });
  expect(Object.keys(pipDiff.newPackages)).toBeEmpty();
  expect(Object.keys(pipDiff.removedPackages)).toBeEmpty();
  expect(Object.keys(condaDiff.newPackages)).toBeEmpty();
  expect(Object.keys(condaDiff.removedPackages).length).toBeGreaterThanOrEqual(2); // at least ipycanvas and bqplot

  // specs are removed
  expect(env.specs).not.toInclude('ipycanvas=0.13.2', 'ipycanvas', 'bqplot<1');
  expect(env.specs).toEqualUnsorted(['pandas', 'xeus-python'])

  condaPackageNames = Object.values(env.packages).map(pkg => pkg.name);
  pipPackageNames = Object.values(env.pipPackages).map(pkg => pkg.name);

  expect(condaPackageNames).not.toInclude('ipycanvas', 'bqplot');
  expect(pipPackageNames).toInclude('ipydatagrid');

  oldLock = env;
  env = await pipUninstall(['ipydatagrid'], env, logger);
  newLock = env;

  // Test diff helper function
  pipDiff = computePipPackagesDiff({ oldLock, newLock });
  condaDiff = computeCondaPackagesDiff({ oldLock, newLock });
  expect(Object.keys(pipDiff.newPackages)).toBeEmpty();
  expect(Object.keys(pipDiff.removedPackages).length).toEqual(1) // only ipydatagrid (no dependency removal with pip);
  expect(Object.keys(condaDiff.newPackages)).toBeEmpty();
  expect(Object.keys(condaDiff.removedPackages)).toBeEmpty();

  pipPackageNames = Object.values(env.pipPackages).map(pkg => pkg.name);

  expect(pipPackageNames).not.toInclude('ipydatagrid');
});

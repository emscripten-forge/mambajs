import { create, install } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
channels:
  - https://repo.prefix.dev/emscripten-forge-dev
  - https://repo.prefix.dev/conda-forge
dependencies:
  - pandas
  - xeus-python
  - pip:
    - ipycanvas
`;

create({yml, logger}).then(async env => {
  env = await install(['ipycanvas', 'bqplot'], env, [], logger);

  const condaPackageNames = Object.values(env.packages).map(pkg => pkg.name);
  const pipPackageNames = Object.values(env.pipPackages).map(pkg => pkg.name);

  expect(condaPackageNames).toInclude('xeus-python', 'xeus-python-shell', 'pandas', 'ipycanvas');
  expect(pipPackageNames).toBeEmpty();
});

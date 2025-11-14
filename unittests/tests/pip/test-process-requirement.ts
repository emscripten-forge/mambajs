import { ISolvedPipPackages } from "../../../packages/mambajs-core/src";
import { parsePyPiRequirement, processRequirement } from "../../../packages/mambajs/src/solverpip";
import { TestLogger } from "../../helpers";
import type { Platform } from '@conda-org/rattler';
import { expect } from 'earl';

const logger = new TestLogger();

function getPackage(name: string, installed: ISolvedPipPackages) {
  for (const pkg of Object.values(installed)) {
    if (pkg.name === name) {
      return pkg;
    }
  }

  throw new Error(`Pip package ${name} is not installed`);
}

function testInstall(
  requirement: string,
  pythonVersion: number[],
  platform: Platform,
  testFct: (pkgs: ISolvedPipPackages) => void
) {
  const installed: ISolvedPipPackages = {};
  parsePyPiRequirement(requirement).then((parsedReq) => {
    processRequirement({
      requirement: parsedReq,
      pythonVersion,
      pipSolvedPackages: installed,
      platform,
      logger
    }).then(() => {
      testFct(installed);
    });
  })
}

testInstall(
  'pandas===2.3.3',
  [3, 13, 0],
  'linux-64',
  (installed) => {
    const pkg = getPackage('pandas', installed);
    expect(pkg.version).toEqual('2.3.3');
    expect(pkg.url).toInclude('pandas-2.3.3-cp313-cp313-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl');
  }
);

testInstall(
  'pandas===2.3.2',
  [3, 12, 0],
  'win-64',
  (installed) => {
    const pkg = getPackage('pandas', installed);
    expect(pkg.version).toEqual('2.3.2');
    expect(pkg.url).toInclude('pandas-2.3.2-cp312-cp312-win_amd64.whl');
  }
);

testInstall(
  'pandas<2.3.2',
  [3, 10, 0],
  'win-64',
  (installed) => {
    const pkg = getPackage('pandas', installed);
    expect(pkg.version).toEqual('2.3.1');
    expect(pkg.url).toInclude('pandas-2.3.1-cp310-cp310-win_amd64.whl');
  }
);

testInstall(
  'ipycanvas===0.14.1',
  [3, 14, 0],
  'win-64',
  (installed) => {
    const pkg = getPackage('ipycanvas', installed);
    expect(pkg.version).toEqual('0.14.1');
    expect(pkg.url).toInclude('ipycanvas-0.14.1-py2.py3-none-any.whl');
  }
);

testInstall(
  'ipycanvas===0.14.1',
  [3, 12, 0],
  'emscripten-wasm32',
  (installed) => {
    const pkg = getPackage('ipycanvas', installed);
    expect(pkg.version).toEqual('0.14.1');
    expect(pkg.url).toInclude('ipycanvas-0.14.1-py2.py3-none-any.whl');
  }
);

testInstall(
  'Checkm>0.3,<0.5',
  [3, 12, 0],
  'win-64',
  (installed) => {
    const pkg = getPackage('Checkm', installed);
    expect(pkg.version).toEqual('0.4');
    expect(pkg.url).toInclude('Checkm-0.4.tar.gz');
  }
);

testInstall(
  'git+https://github.com/jupyter-widgets-contrib/ipycanvas@0.12.0',
  [3, 12, 0],
  'linux-64',
  (installed) => {
    const pkg = getPackage('ipycanvas', installed);
    expect(pkg.registry).toEqual('GitHub');
    // TODO Better support for detecting the version...
    // Not easy really
    // expect(pkg.version).toEqual('0.12.0');

    // Make sure dependencies are there
    expect(getPackage('ipywidgets', installed).name).not.toBeEmpty();
  }
);

testInstall(
  'git+https://github.com/dateutil/dateutil',
  [3, 12, 0],
  'linux-64',
  (installed) => {
    const pkg = getPackage('python-dateutil', installed);
    expect(pkg.registry).toEqual('GitHub');
  }
);

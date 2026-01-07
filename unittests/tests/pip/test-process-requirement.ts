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
  processRequirement({
    requirement: parsePyPiRequirement(requirement),
    pythonVersion,
    pipSolvedPackages: installed,
    platform,
    logger
  }).then(() => {
    testFct(installed);
  });
}

const tests = [
  { req: "geemap", pkg: "geemap" },
  { req: "requests", pkg: "requests" },
  { req: "numpy>=1.22", pkg: "numpy" },
  { req: "pandas==2.1.4", pkg: "pandas" },
  { req: "pytest~=7.4", pkg: "pytest" },
  // TODO unsupported notation
  // { req: "sqlalchemy!=2.0.3", pkg: "sqlalchemy" },

  { req: "jaraco.classes>=2.0", pkg: "jaraco.classes" },
  { req: "zope.interface==6.0", pkg: "zope.interface" },

  // // 17–20 constraints
  { req: "Django>=4.2,<5.0", pkg: "Django" },
  { req: "matplotlib>3.7", pkg: "matplotlib" },
  { req: "tqdm<=4.66", pkg: "tqdm" },
  // TODO Not supported yet
  // { req: "sqlmodel!=0.0.7", pkg: "sqlmodel" },
];

for (const t of tests) {
  testInstall(
    t.req,
    [3, 11, 0], // arbitrary stable Python version
    "linux-64",
    (installed) => {
      const pkg = getPackage(t.pkg, installed);
      expect(pkg.name).toEqual(t.pkg);
    }
  );
};

testInstall(
  'pandas===2.3.3',
  [3, 13, 0],
  'linux-64',
  (installed) => {
    const pkg = getPackage('pandas', installed);
    expect(pkg.version).toEqual('2.3.3');
    expect(pkg.hash.md5).toEqual('4d60ea1e94ec268ba0daab994f5311f3');
    expect(pkg.hash.sha256).toEqual('318d77e0e42a628c04dc56bcef4b40de67918f7041c2b061af1da41dcff670ac');
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
    expect(pkg.size).toEqual(142972);
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

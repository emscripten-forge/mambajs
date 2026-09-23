import { solvePip } from '../../../packages/mambajs/src/solverpip';
import { TestLogger } from '../../helpers';
import { expect } from 'earl';

const packages = {
  "python-3.13.1-h_2efca29_11_cp313.tar.bz2": {
    "name": "python",
    "build": "h_2efca29_11_cp313",
    "version": "3.13.1",
    "subdir": "emscripten-wasm32",
    "channel": "emscripten-forge-4x",
    "hash": {
      "md5": "6541a249de9b863533e745bdeeb6d346",
      "sha256": "87a2f18dd094535772fba34526a2398902e0e9e385435f135932a9e563f96acb"
    },
    "size": 5731072
  }
};

const logger = new TestLogger();
const customIndex = 'https://pypi.anaconda.org/scientific-python-nightly-wheels/simple';

// Installing from a custom (non-PyPI) index should pull the wheel from that index
// instead of pypi.org, and its dependencies should also be resolved
solvePip(
  '',
  packages,
  {},
  {},
  ['contourpy', 'numpy'],
  logger,
  'emscripten-wasm32',
  [customIndex]
).then(result => {
  const packageNames = Object.values(result).map(pkg => pkg.name);
  expect(packageNames).toInclude('numpy');

  const contourpy = Object.values(result).find(
    pkg => pkg.name === 'contourpy'
  );
  expect(contourpy).not.toBeNullish();
  expect(contourpy!.url).toInclude('pypi.anaconda.org');

  expect(packageNames).toInclude(
    'contourpy',
    'numpy'
  );
});

// A package that only exists on PyPI should not be found on the custom index
expect(() =>
  solvePip(
    '',
    packages,
    {},
    {},
    ['this-package-definitely-does-not-exist-on-this-index'],
    logger,
    'emscripten-wasm32',
    [customIndex]
  )
).toBeRejectedWith(
  /ERROR: Could not find a version that satisfies the requirement this-package-definitely-does-not-exist-on-this-index/
);

// --extra-index-url is searched after --index-url/the primary index
solvePip(
  '',
  packages,
  {},
  {},
  ['matplotlib'],
  logger,
  'emscripten-wasm32',
  ['https://this-index-does-not-exist.invalid/simple', customIndex]
).then(result => {
  const matplotlib = Object.values(result).find(
    pkg => pkg.name === 'matplotlib'
  );
  expect(matplotlib).not.toBeNullish();
  expect(matplotlib!.url).toInclude('pypi.anaconda.org');
});

// The --extra-index-url notation should also be supported directly from an environment.yml pip section
const ymlWithExtraIndexUrl = `
name: my_env
channels:
  - conda-forge
dependencies:
  - python=3.9
  - pip
  - pip:
    - --extra-index-url ${customIndex}
    - matplotlib
`;

solvePip(ymlWithExtraIndexUrl, packages, {}, {}, [], logger, 'emscripten-wasm32').then(
  result => {
    const packageNames = Object.values(result).map(pkg => pkg.name);
    expect(packageNames).toInclude('matplotlib');

    const matplotlib = Object.values(result).find(
      pkg => pkg.name === 'matplotlib'
    );
    expect(matplotlib).not.toBeNullish();
    expect(matplotlib!.url).toInclude('pypi.anaconda.org');
  }
);

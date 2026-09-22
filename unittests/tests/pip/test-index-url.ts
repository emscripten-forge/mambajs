import { solvePip } from '../../../packages/mambajs/src/solverpip';
import { TestLogger } from '../../helpers';
import { expect } from 'earl';

const packages = {
  'python-3.12.7-hd12c33a_0_cpython.conda': {
    name: 'python',
    build: 'hd12c33a_0_cpython',
    version: '3.12.7',
    subdir: 'linux-64',
    channel: 'conda-forge',
    hash: {
      md5: '2b4ba962994e8bd4be9ff5b64b75aff2',
      sha256: '76a5d12e73542678b70a94570f7b0f7763f9a938f77f0e75d9ea615ef22aa84c'
    }
  }
};

const logger = new TestLogger();
const customIndex = 'https://pypi.anaconda.org/scientific-python-nightly-wheels/simple';

// Installing from a custom (non-PyPI) index should pull the wheel from that index
// instead of pypi.org
solvePip(
  '',
  packages,
  {},
  {},
  ['matplotlib'],
  logger,
  'linux-64',
  customIndex
).then(result => {
  const packageNames = Object.values(result).map(pkg => pkg.name);
  expect(packageNames).toInclude('matplotlib');

  const matplotlib = Object.values(result).find(
    pkg => pkg.name === 'matplotlib'
  );
  expect(matplotlib).not.toBeNullish();
  expect(matplotlib!.url).toInclude('pypi.anaconda.org');
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
    'linux-64',
    customIndex
  )
).toBeRejectedWith(
  /ERROR: Could not find a version that satisfies the requirement this-package-definitely-does-not-exist-on-this-index/
);

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

solvePip(ymlWithExtraIndexUrl, packages, {}, {}, [], logger, 'linux-64').then(
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

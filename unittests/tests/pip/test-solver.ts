import { solvePip } from '../../../packages/mambajs/src/solverpip';
import { TestLogger } from '../../helpers';
import { expect } from 'earl';

const packages = {
  'python-3.10.14-hd12c33a_0_cpython.conda': {
    name: 'python',
    build: 'hd12c33a_0_cpython',
    version: '3.10.14',
    subdir: 'linux-64',
    channel: 'conda-forge',
    hash: {
      md5: '2b4ba962994e8bd4be9ff5b64b75aff2',
      sha256: '76a5d12e73542678b70a94570f7b0f7763f9a938f77f0e75d9ea615ef22aa84c'
    }
  }
};

const logger = new TestLogger();

const yml = `
dependencies:
  - pip:
    - rich
    - py2vega
`;

solvePip(yml, packages, {}, {}, [], logger).then(result => {
  const packageNames = Object.values(result).map(pkg => pkg.name);

  // One of py2vega's dependencies is gast
  expect(packageNames).toInclude('rich', 'py2vega', 'gast');
  expect(packageNames).not.toInclude('ipywidgets');
});

const ymlPrerelease = `
dependencies:
  - pip:
    - jupytergis-lite==0.16.0a0
`;

async function testPrereleaseSubDependencies() {
  const result = await solvePip(
    ymlPrerelease,
    packages,
    {},
    {},
    [],
    logger,
    'linux-64'
  );
  const packageVersions = Object.values(result).reduce(
    (acc, pkg) => ({ ...acc, [pkg.name]: pkg.version }),
    {} as Record<string, string>
  );

  expect(packageVersions['jupytergis-lite']).toEqual('0.16.0a0');
  expect(packageVersions['jupytergis-core']).toEqual('0.16.0a0');
  expect(packageVersions['jupytergis-lab']).toEqual('0.16.0a0');
}

testPrereleaseSubDependencies().catch(err => {
  throw err;
});

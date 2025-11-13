import { solvePip } from "../../../packages/mambajs/src/solverpip";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const packages = {
  "python-3.10.14-hd12c33a_0_cpython.conda": {
    "name": "python",
    "build": "hd12c33a_0_cpython",
    "version": "3.10.14",
    "subdir": "linux-64",
    "channel": "conda-forge",
    "hash": {
      "md5": "2b4ba962994e8bd4be9ff5b64b75aff2",
      "sha256": "76a5d12e73542678b70a94570f7b0f7763f9a938f77f0e75d9ea615ef22aa84c"
    }
  }
};

const logger = new TestLogger();

// Test 1: Verify pandas can be installed with linux-64 platform
const ymlPandas = `
dependencies:
  - pip:
    - pandas
`;

solvePip(ymlPandas, packages, {}, {}, [], logger, "linux-64").then(result => {
  const packageNames = Object.values(result).map(pkg => pkg.name);

  // pandas should be successfully installed with linux-64 platform
  expect(packageNames).toInclude('pandas');

  // Check that pandas has platform-specific dependencies
  expect(packageNames).toInclude('python-dateutil');
  expect(packageNames).toInclude('pytz');

  // Verify the pandas package has the correct wheel type
  const pandasPkg = Object.values(result).find(pkg => pkg.name === 'pandas');

  // Verify that we found pandas and it has a proper URL
  if (pandasPkg) {
    // The URL should contain a linux-compatible wheel (manylinux or linux_x86_64)
    const hasLinuxWheel = pandasPkg.url.includes('linux_x86_64') ||
                         pandasPkg.url.includes('manylinux');
    expect(hasLinuxWheel).toEqual(true);
  }
});

// Test 2: Verify pure Python packages still work without platform
const ymlPure = `
dependencies:
  - pip:
    - requests
`;

solvePip(ymlPure, packages, {}, {}, [], logger).then(result => {
  const packageNames = Object.values(result).map(pkg => pkg.name);
  expect(packageNames).toInclude('requests');
  expect(packageNames).toInclude('urllib3');
  expect(packageNames).toInclude('certifi');
});

// Test 3: Verify platform-specific packages fail without platform
expect(solvePip(ymlPandas, packages, {}, {}, [], logger)).toBeRejectedWith('binary built package that is not compatible with WASM');

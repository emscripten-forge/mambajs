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

// Test for package with invalid version constraint
const logger = new TestLogger();
const ymlInvalidVersion = `
dependencies:
  - pip:
    - ipycanvas=0.14.1
`;

expect(() => solvePip(ymlInvalidVersion, packages, {}, {}, [], logger)).toBeRejectedWith(/ERROR: Invalid requirement/);

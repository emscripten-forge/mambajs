import { solvePip } from '../../../packages/mambajs/src/solverpip';
import { TestLogger } from '../../helpers';
import { expect } from 'earl';

const logger = new TestLogger();
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

// Test with GitHub URL on emscripten-wasm32 platform (should fail)
const yml = `
dependencies:
  - pip:
    - git+https://github.com/dateutil/dateutil@9eaa5de584f9f374c6e4943069925cc53522ad61
`;

// Test for emscripten-wasm32 platform (should throw error)
solvePip(yml, packages, {}, {}, [], logger, 'emscripten-wasm32')
  .then(() => {
    throw new Error(
      'Expected an error when installing GitHub URL on emscripten-wasm32'
    );
  })
  .catch(error => {
    // Should fail with appropriate error message
    expect(error.message).toInclude('emscripten-wasm32');
    expect(error.message).toInclude('GitHub');
  });

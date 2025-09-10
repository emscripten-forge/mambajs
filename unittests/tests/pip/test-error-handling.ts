import { solvePip } from "../../../packages/mambajs/src/solverpip";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

// Test for package with invalid version constraint
const logger = new TestLogger();
const ymlInvalidVersion = `
dependencies:
  - pip:
    - setuptools==99.99.99  # Use a version that definitely doesn't exist
`;

solvePip(ymlInvalidVersion, {}, {}, {}, [], logger).catch(error => {
  // Verify that the error message matches pip's format with available versions listed
  const errorMessage = error.message;
  expect(errorMessage.includes('ERROR: Could not find a version that satisfies the requirement setuptools==99.99.99')).toEqual(true);
  expect(errorMessage.includes('from versions:')).toEqual(true);
  expect(errorMessage.includes('80.9.0')).toEqual(true); // Should contain actual available versions
  
  console.log('✅ Invalid version error format test passed');
});
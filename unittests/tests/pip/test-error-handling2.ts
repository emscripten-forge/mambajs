import { solvePip } from "../../../packages/mambajs/src/solverpip";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

// Test for package with invalid version constraint
const logger = new TestLogger();
const ymlInvalidVersion = `
dependencies:
  - pip:
    - ipycanvas=0.14.1
`;

expect(() => solvePip(ymlInvalidVersion, {}, {}, {}, [], logger)).toBeRejectedWith(/ERROR: Invalid requirement/);

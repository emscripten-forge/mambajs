import { solvePip } from "../../../packages/mambajs/src/solverpip";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
dependencies:
  - pip:
    - pandas
`;

expect(solvePip(yml, {}, {}, {}, [], logger)).toBeRejectedWith('binary built package that is not compatible with WASM');

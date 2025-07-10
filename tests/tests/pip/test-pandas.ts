import { solvePip } from "../../../packages/mambajs/src/solverpip";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
dependencies:
  - pip:
    - pandas
`;

expect(solvePip(yml, {}, {}, {}, [], logger)).toBeRejectedWith('Cannot install pandas from PyPi')

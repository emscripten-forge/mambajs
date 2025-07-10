import { solvePip } from "../../../packages/mambajs/src/solverpip";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
dependencies:
  - pip:
    - rich[jupyter]
    - py2vega
`;

solvePip(yml, {}, {}, {}, [], logger).then(result => {
  const packageNames = Object.values(result).map(pkg => pkg.name);

  // Rich's extra dependency is ipywidgets
  expect(packageNames).toInclude('rich', 'py2vega', 'ipywidgets');
});

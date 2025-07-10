import { solvePip } from "../../../packages/mambajs/src/solverpip";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
dependencies:
  - pip:
    - rich
    - py2vega
`;

solvePip(yml, {}, {}, {}, [], logger).then(result => {
  const packageNames = Object.values(result).map(pkg => pkg.name);

  // One of py2vega's dependencies is gast
  expect(packageNames).toInclude('rich', 'py2vega', 'gast');
  expect(packageNames).not.toInclude('ipywidgets');
});

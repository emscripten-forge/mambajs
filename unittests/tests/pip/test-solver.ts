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

  // Check that py2vega has gast as a dependency
  const py2vega = Object.values(result).find(pkg => pkg.name === 'py2vega');
  expect(py2vega!.depends).toInclude('gast');
});

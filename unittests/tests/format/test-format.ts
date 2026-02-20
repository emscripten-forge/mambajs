import { solve } from "../../../packages/mambajs/src";
import { TestLogger } from "../../helpers";
import { expect } from 'earl';

const logger = new TestLogger();

const yml = `
channels:
  - https://prefix.dev/emscripten-forge-3x
  - https://prefix.dev/conda-forge
dependencies:
  - pandas
  - xeus-python
`;

solve({ymlOrSpecs: yml, logger}).then(async result => {
  // Test format of table output is correct in terms of columns aligned and number of
  // spaces between columns.

  // Find row matching start of "  Name"
  const headerIndex = logger.logs.findIndex(line => line.startsWith("  Name"));
  expect(headerIndex).toBeGreaterThanOrEqual(0);

  const tableHeader = logger.logs[headerIndex];
  const tableBody = logger.logs.slice(headerIndex+2)

  const colIndices = ['Name', 'Version', 'Build', 'Channel'].map(m => tableHeader.indexOf(m));
  const ncol = colIndices.length;

  // Find minimum number of spaces between columns in table.
  const nspaces = [Infinity, Infinity, Infinity, Infinity];
  tableBody.forEach(line => {
    for (let i = 0; i < ncol; i++) {
      const item = line.slice(colIndices[i], i == ncol-1 ? -1 : colIndices[i+1]);
      const match = item.match(/^[\w\-\.]+( *)/);  // Text/number/dash/dot followed by whitespace
      expect(match).not.toBeNullish();
      const nspace = match[1].length;
      if (nspace < nspaces[i]) {
        nspaces[i] = nspace;
      }
    }
  })

  expect(nspaces).toEqual([2, 2, 2, 0]);
});

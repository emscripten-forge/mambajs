import { solvePip } from "../packages/mambajs/src/solverpip";

const yml = `
dependencies:
  - pip:
      - rich[jupyter]
`;

const logger = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

solvePip(yml, {}, {}, {}, [], logger).then(result => {
  console.log('✅ Solved pip packages:\n', result);
});

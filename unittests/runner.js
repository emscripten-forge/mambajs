import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testsDir = path.resolve(__dirname, 'testlib', 'unittests');

let nTests = 0;
let nSuccess = 0;
let nFailures = 0;

function runTests(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      runTests(fullPath);
    } else if (file.startsWith('test-') && file.endsWith('.js')) {
      nTests++;

      const testname = path.relative(__dirname, fullPath);
      console.log(`🚩 Running ${testname}`);

      try {
        const result = spawnSync('node', [fullPath], {
          encoding: 'utf-8',
          stdio: ['inherit', 'inherit', 'pipe'],
        });

        if (result.status !== 0) {
          console.error(`❌ test file ${testname} failed with:`);
          console.error(result.stderr);
          process.exitCode = 1;
          nFailures++;
        }

        nSuccess++;
        console.log(`✅ Test passed ${testname}`);
      } catch (err) {
        console.error(`Unexpected error while running ${fullPath}`);
        console.error(err.stack || err.message || err);
        process.exitCode = 1;
        nFailures++;
      }
    }
  }
}

runTests(testsDir);

console.log(`\nTest runs: ${nTests}; ✅ Passed: ${nSuccess}; ❌ Failed: ${nFailures}\n`);

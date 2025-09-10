import { solvePip } from "../../../packages/mambajs/src/solverpip";
import { expect } from 'earl';
import { ILogger } from "@emscripten-forge/mambajs-core";

// Custom logger that captures errors without throwing
class ErrorCapturingLogger implements ILogger {
  private _errors: string[] = [];
  private _logs: string[] = [];
  private _warnings: string[] = [];

  log(...msg: any[]): void {
    const message = msg.join(' ');
    console.log('LOG --', message);
    this._logs.push(message);
  }

  error(...msg: any[]): void {
    const message = msg.join(' ');
    console.error('ERROR --', message);
    this._errors.push(message);
  }

  warn(...msg: any[]): void {
    const message = msg.join(' ');
    console.warn('WARNING --', message);
    this._warnings.push(message);
  }

  getErrors(): string[] {
    return [...this._errors];
  }

  getLogs(): string[] {
    return [...this._logs];
  }

  getWarnings(): string[] {
    return [...this._warnings];
  }

  clear() {
    this._errors = [];
    this._logs = [];
    this._warnings = [];
  }
}

const logger = new ErrorCapturingLogger();

// Test for package with invalid version constraint (should show available versions)
const ymlInvalidVersion = `
dependencies:
  - pip:
    - xyzservices==2024
`;

solvePip(ymlInvalidVersion, {}, {}, {}, [], logger).catch(error => {
  // Verify that the error message matches pip's format
  const errorMessage = error.message;
  expect(errorMessage.includes('ERROR: Could not find a version that satisfies the requirement xyzservices==2024 (from versions:')).toEqual(true);
  
  // Check that the logger received both error messages like pip
  const errorMessages = logger.getErrors();
  expect(errorMessages.length >= 2).toEqual(true);
  expect(errorMessages[0].includes('ERROR: Could not find a version that satisfies the requirement xyzservices==2024 (from versions:')).toEqual(true);
  expect(errorMessages[1]).toEqual('ERROR: No matching distribution found for xyzservices==2024');
  
  // Verify that available versions are listed in the error message
  expect(errorMessages[0].includes('2024.4.0')).toEqual(true); // Should contain actual available versions
  expect(errorMessages[0].includes('2024.6.0')).toEqual(true);
  expect(errorMessages[0].includes('2024.9.0')).toEqual(true);
  
  console.log('✅ Invalid version error format test passed');
});

// Test for non-existent package
const logger2 = new ErrorCapturingLogger();
const ymlNonexistentPackage = `
dependencies:
  - pip:
    - nonexistentpackage12345
`;

solvePip(ymlNonexistentPackage, {}, {}, {}, [], logger2).catch(error => {
  // Verify that the error message for non-existent packages
  const errorMessage = error.message;
  expect(errorMessage.includes('ERROR: Could not find a version that satisfies the requirement nonexistentpackage12345')).toEqual(true);
  
  const errorMessages = logger2.getErrors();
  expect(errorMessages.length >= 2).toEqual(true);
  expect(errorMessages[0].includes('ERROR: Could not find a version that satisfies the requirement nonexistentpackage12345')).toEqual(true);
  expect(errorMessages[1]).toEqual('ERROR: No matching distribution found for nonexistentpackage12345');
  
  console.log('✅ Non-existent package error format test passed');
});
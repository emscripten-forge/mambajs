import { ILogger } from "../packages/mambajs-core";

export class TestLogger implements ILogger {
  constructor(options: { expectError?: boolean }) {
    this._expectError = options.expectError;
  }

  log(...msg: any[]): void {
    const message = msg.join(' ');
    console.log(message);
    this.logs = [this.logs, message].join(' ');
  }

  error(...msg: any[]): void {
    const message = msg.join(' ');
    if (!this._expectError) {
      throw new Error(message);
    } else {
      console.error(message);
      this.errors = [this.errors, message].join(' ');
    }
  }

  warn(...msg: any[]): void {
    const message = msg.join(' ');
    console.warn(message);
    this.warnings = [this.warnings, message].join(' ');
  }

  warnings = '';
  logs = '';
  errors = '';

  private _expectError = false;
}

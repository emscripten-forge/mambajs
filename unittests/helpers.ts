import { ILogger } from "@emscripten-forge/mambajs-core";

export class TestLogger implements ILogger {
  log(...msg: any[]): void {
    if (!msg) {
      return;
    }

    const message = msg.join(' ');
    console.log('LOG --', message);
    this.logs.push(message);
  }

  error(...msg: any[]): void {
    const message = msg.join(' ');
    console.error('ERROR --', message);
    throw new Error(message);
  }

  warn(...msg: any[]): void {
    const message = msg.join(' ');
    console.warn('WARNING --', message);
    this.warnings = [this.warnings, message].join(' ');
  }

  warnings = '';
  logs: string[] = [];
  errors = '';
}

import { parse } from "../../../packages/mambajs/src";
import { expect } from 'earl';

const cmd = parse('%pwd');

expect(cmd.commands).toBeEmpty();
expect(cmd.run.trim()).toEqual("%pwd");

expect(() => parse('%pip unknown')).toThrow(`Unknown pip command 'unknown'`)
expect(() => parse('%conda unknown')).toThrow(`Unknown conda command 'unknown'`)
expect(() => parse('%rattler unknown')).toThrow(`Unknown rattler command 'unknown'`)

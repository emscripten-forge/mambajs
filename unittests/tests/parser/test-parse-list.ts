import { parse } from "../../../packages/mambajs/src";
import { expect } from 'earl';

let cmd = parse('%conda list');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('list');

cmd = parse('%pip list');

expect(cmd.commands[0].data.type).toEqual('pip');
expect(cmd.commands[0].type).toEqual('list');

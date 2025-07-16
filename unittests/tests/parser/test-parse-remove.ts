import { IUninstallationCommandOptions, parse } from "../../../packages/mambajs/src";
import { expect } from 'earl';

let cmd = parse('%conda remove ipycanvas');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('remove');
expect((cmd.commands[0].data as IUninstallationCommandOptions).specs).toEqual(['ipycanvas']);

cmd = parse('%conda     remove   ipycanvas    numpy');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('remove');
expect((cmd.commands[0].data as IUninstallationCommandOptions).specs).toEqual(['ipycanvas', 'numpy']);

cmd = parse('%pip uninstall ipycanvas');

expect(cmd.commands[0].data.type).toEqual('pip');
expect(cmd.commands[0].type).toEqual('remove');
expect((cmd.commands[0].data as IUninstallationCommandOptions).specs).toEqual(['ipycanvas']);

cmd = parse(`
%conda remove numpy
%pip uninstall ipycanvas bqplot

print('Hello world')
`);

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('remove');
expect((cmd.commands[0].data as IUninstallationCommandOptions).specs).toEqual(['numpy']);
expect(cmd.commands[1].data.type).toEqual('pip');
expect(cmd.commands[1].type).toEqual('remove');
expect((cmd.commands[1].data as IUninstallationCommandOptions).specs).toEqual(['ipycanvas', 'bqplot']);
expect(cmd.run.trim()).toEqual("print('Hello world')");

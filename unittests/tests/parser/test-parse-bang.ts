import { IInstallationCommandOptions, IUninstallationCommandOptions, parse } from "../../../packages/mambajs/src";
import { expect } from 'earl';

// Test !pip commands
let cmd = parse('!pip install ipycanvas');

expect(cmd.commands[0].data.type).toEqual('pip');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['ipycanvas']);

cmd = parse('!pip list');

expect(cmd.commands[0].data.type).toEqual('pip');
expect(cmd.commands[0].type).toEqual('list');

cmd = parse('!pip uninstall ipycanvas');

expect(cmd.commands[0].data.type).toEqual('pip');
expect(cmd.commands[0].type).toEqual('remove');
expect((cmd.commands[0].data as IUninstallationCommandOptions).specs).toEqual(['ipycanvas']);

// Test !mamba commands
cmd = parse('!mamba install numpy');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['numpy']);

cmd = parse('!mamba list');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('list');

cmd = parse('!mamba remove numpy');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('remove');
expect((cmd.commands[0].data as IUninstallationCommandOptions).specs).toEqual(['numpy']);

// Test all conda aliases with !
cmd = parse('!conda install package1');
expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['package1']);

cmd = parse('!micromamba install package2');
expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['package2']);

cmd = parse('!un install package3');
expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['package3']);

cmd = parse('!rattler install package4');
expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['package4']);

// Test mixed ! and % commands
cmd = parse(`
!conda install numpy
%pip install ipycanvas
!mamba install scipy

print('Hello world')
`);

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['numpy']);
expect(cmd.commands[1].data.type).toEqual('pip');
expect(cmd.commands[1].type).toEqual('install');
expect((cmd.commands[1].data as IInstallationCommandOptions).specs).toEqual(['ipycanvas']);
expect(cmd.commands[2].data.type).toEqual('conda');
expect(cmd.commands[2].type).toEqual('install');
expect((cmd.commands[2].data as IInstallationCommandOptions).specs).toEqual(['scipy']);
expect(cmd.run.trim()).toEqual("print('Hello world')");

// Test error handling for unknown commands
expect(() => parse('!pip unknown')).toThrow(`Unknown pip command 'unknown'`);
expect(() => parse('!conda unknown')).toThrow(`Unknown conda command 'unknown'`);
expect(() => parse('!mamba unknown')).toThrow(`Unknown mamba command 'unknown'`);
expect(() => parse('!rattler unknown')).toThrow(`Unknown rattler command 'unknown'`);

// Test that unrecognized ! commands are treated as regular code
const unrecognizedCmd = parse('!pwd');
expect(unrecognizedCmd.commands).toBeEmpty();
expect(unrecognizedCmd.run.trim()).toEqual("!pwd");
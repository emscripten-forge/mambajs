import { IInstallationCommandOptions, parse } from "../../../packages/mambajs/src";
import { expect } from 'earl';

let cmd = parse('%conda install ipycanvas numpy>2');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['ipycanvas', 'numpy>2']);

cmd = parse('%rattler install ipycanvas numpy>2');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['ipycanvas', 'numpy>2']);

cmd = parse('%conda   install   ipycanvas    numpy>2');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['ipycanvas', 'numpy>2']);

cmd = parse('%pip install ipycanvas');

expect(cmd.commands[0].data.type).toEqual('pip');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['ipycanvas']);

cmd = parse(`
%conda install numpy
%pip install ipycanvas bqplot

print('Hello world')
`);

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['numpy']);
expect(cmd.commands[1].data.type).toEqual('pip');
expect(cmd.commands[1].type).toEqual('install');
expect((cmd.commands[1].data as IInstallationCommandOptions).specs).toEqual(['ipycanvas', 'bqplot']);
expect(cmd.run.trim()).toEqual("print('Hello world')");

cmd = parse('%conda install ipycanvas numpy>2 -c conda-forge -c emscripten-forge');

expect(cmd.commands[0].data.type).toEqual('conda');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['ipycanvas', 'numpy>2']);
expect((cmd.commands[0].data as IInstallationCommandOptions).channels).toEqual(['conda-forge', 'emscripten-forge']);

expect(() => parse('%pip install git+https://github.com/org/repo.git')).toThrow(`Unsupported option 'git+https://github.com/org/repo.git'`);
expect(() => parse('%pip install pathToWheel.whl')).toThrow(`Unsupported option 'pathToWheel.whl'`);
expect(() => parse('%pip install --index-url ipycanvas')).toThrow(`Unsupported option '--index-url'`);

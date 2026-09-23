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
expect(() => parse('%pip install -i')).toThrow(`Missing value for option '-i'`);
expect(() => parse('%pip install --index-url')).toThrow(`Missing value for option '--index-url'`);
expect(() => parse('%pip install --extra-index-url')).toThrow(`Missing value for option '--extra-index-url'`);

cmd = parse('%pip install -i https://pypi.anaconda.org/scientific-python-nightly-wheels/simple matplotlib');

expect(cmd.commands[0].data.type).toEqual('pip');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['matplotlib']);
expect((cmd.commands[0].data as IInstallationCommandOptions).pipIndexes).toEqual(['https://pypi.anaconda.org/scientific-python-nightly-wheels/simple']);

cmd = parse('%pip install matplotlib --index-url https://pypi.anaconda.org/scientific-python-nightly-wheels/simple');

expect(cmd.commands[0].data.type).toEqual('pip');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['matplotlib']);
expect((cmd.commands[0].data as IInstallationCommandOptions).pipIndexes).toEqual(['https://pypi.anaconda.org/scientific-python-nightly-wheels/simple']);

cmd = parse('%pip install --extra-index-url https://pypi.anaconda.org/scientific-python-nightly-wheels/simple matplotlib');

expect(cmd.commands[0].data.type).toEqual('pip');
expect(cmd.commands[0].type).toEqual('install');
expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['matplotlib']);
expect((cmd.commands[0].data as IInstallationCommandOptions).pipIndexes).toEqual(['https://pypi.anaconda.org/scientific-python-nightly-wheels/simple']);

cmd = parse('%pip install matplotlib --extra-index-url https://pypi.anaconda.org/scientific-python-nightly-wheels/simple');

expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['matplotlib']);
expect((cmd.commands[0].data as IInstallationCommandOptions).pipIndexes).toEqual(['https://pypi.anaconda.org/scientific-python-nightly-wheels/simple']);

// --index-url is the primary index, --extra-index-url can be repeated to add additional ones
cmd = parse('%pip install --index-url https://custom.pypi.repo/simple --extra-index-url https://pypi.anaconda.org/scientific-python-nightly-wheels/simple --extra-index-url https://another.pypi.repo/simple matplotlib');

expect((cmd.commands[0].data as IInstallationCommandOptions).specs).toEqual(['matplotlib']);
expect((cmd.commands[0].data as IInstallationCommandOptions).pipIndexes).toEqual([
  'https://custom.pypi.repo/simple',
  'https://pypi.anaconda.org/scientific-python-nightly-wheels/simple',
  'https://another.pypi.repo/simple'
]);

cmd = parse('%pip install ipycanvas');

expect((cmd.commands[0].data as IInstallationCommandOptions).pipIndexes).toEqual(undefined);

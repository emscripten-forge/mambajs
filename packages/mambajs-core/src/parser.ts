export interface IParsedCommand {
  type: CommandsName;
  data: IInstallationCommandOptions | IUninstallationCommandOptions | null;
}

type CommandsName = 'install' | 'list' | 'remove' | 'uninstall';

export interface ICommandData {
  commands: IParsedCommand[];
  run: string;
}

export interface IInstallationCommandOptions {
  channels: string[];
  specs: string[];
  pipSpecs: string[];
}

export interface IUninstallationCommandOptions {
  specs: string[];
  env?: string;
  flags?: string[];
}

export type SpecTypes = 'specs' | 'pipSpecs';

/**
 * Parses a command-line string and classifies it into installation commands,
 * runnable code, or conda list operations.
 *
 * - If the code is a list command, it sets the `list` flag to true.
 * - If the code contains conda or pip installation command, then it tries to parse it
 * - Otherwise code will be executed as it is
 *
 * @param {string} code - The raw command-line input string to be parsed.
 * @returns {ICommands} An object containing:
 *  - parsed installation options,
 *  - run command code,
 *  - and a list flag indicating whether a list command was detected.
 */
export function parse(code: string): ICommandData {
  let result: ICommandData = {
    commands: [],
    run: code
  };

  const codeLines = code.split('\n');
  if (codeLines.length > 1) {
    result = { ...parseLines(codeLines) };
  } else {
    if (hasCommand(code)['list']) {
      const command: IParsedCommand = {
        type: 'list',
        data: null
      };

      result = {
        commands: [command],
        run: ''
      };
    } else {
      const parsedData = { ...parseCommand(code) };
      if (parsedData.command) {
        result = {
          commands: [parsedData.command],
          run: parsedData.run
        };
      } else {
        result = {
          commands: [],
          run: parsedData.run
        };
      }
    }
  }
  return result;
}

/**
 * Parses one row of code and detects whether it is conda or pip installation command.
 * runnable code, or conda list operations.
 *
 * @param {string} code - The raw command-line input string to be parsed.
 * @returns {IParsedCommands} An object containing:
 *  - parsed installation options,
 *  - run command code
 */
function parseCommand(code: string): {
  command: IParsedCommand | null;
  run: string;
} {
  const run = code;
  let result: {
    command: IParsedCommand | null;
    run: string;
  } = {
    command: null,
    run
  };
  const isCommand = hasCommand(code);
  if (isCommand.install) {
    result = parseInstallCommand(code);
  } else if (isCommand.remove || isCommand.uninstall) {
    result = parseRemoveCommand(code);
  }
  return result;
}

function parseRemoveCommand(code: string): {
  command: IParsedCommand | null;
  run: string;
} {
  const run = code;
  let isPipCommand = false;

  if (code.includes('%pip uninstall')) {
    isPipCommand = true;
  }
  // todo to pip uninstall
  code = replaceCommandHeader(code, 'remove');

  const command: IParsedCommand = {
    type: 'remove',
    data: {
      specs: [],
      env: '',
      flags: []
    }
  };

  if (code) {
    if (isPipCommand) {
      command.data = parsePipUninstallCommand(code);
    } else {
      command.data = parseCondaRemoveCommand(code);
    }

    return {
      command,
      run: ''
    };
  } else {
    return {
      command: null,
      run
    };
  }
}

function parsePipUninstallCommand(code: string) {}

export interface IUninstallationCommandOptions {
  specs: string[];
  env?: string;
  flags?: string[];
}

function parseCondaRemoveCommand(code: string): IUninstallationCommandOptions {
  const parts = code.split(' ');
  const specs: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part) {
      //todo we have to check if we have env name;
      specs.push(part);
    }
  }

  return {
    specs,
    env: '',
    flags: []
  };
}

function parseInstallCommand(code: string): {
  command: IParsedCommand | null;
  run: string;
} {
  const run = code;
  let isPipCommand = false;

  if (code.includes('%pip install')) {
    isPipCommand = true;
  }

  code = replaceCommandHeader(code, 'install');
  const command: IParsedCommand = {
    type: 'install',
    data: {
      channels: [],
      specs: [],
      pipSpecs: []
    }
  };

  if (code) {
    if (isPipCommand) {
      command.data = parsePipInstallCommand(code);
    } else {
      command.data = parseCondaInstallCommand(code);
    }

    return {
      command,
      run: ''
    };
  } else {
    return {
      command: null,
      run
    };
  }
}

/**
 * Parses multiply lines
 *
 * @param {string[]} codeLines - The command line which should be parsed.
 * @returns {ICommands} An object containing:
 *  - parsed installation options,
 *  - run command code,
 *  - and a list flag indicating whether a list command was detected.
 */

function parseLines(codeLines: string[]): ICommandData {
  const runCommands: string[] = [];
  const commands: IParsedCommand[] = [];
  codeLines.forEach((line: string) => {
    const isCommand = hasCommand(line);
    if (isCommand['install'] || isCommand['remove'] || isCommand['uninstall']) {
      const { command } = { ...parseCommand(line) };
      if (command) {
        commands.push(command);
      }
    } else if (isCommand['list']) {
      commands.push({ type: 'list', data: null });
    } else {
      runCommands.push(line);
    }
  });

  return {
    commands,
    run: runCommands.length ? runCommands.join('\n') : ''
  };
}

/**
 * Detects whether the line has conda installation commands
 * and replace the patter '[commandNames] install' for futher calculations
 *
 * @param {string} code - The command line which should be parsed.
 * @returns {string} - Can be as part of conda installation command and as code
 */
function replaceCommandHeader(code: string, command: string): string {
  const commandNames = ['micromamba', 'un', 'mamba', 'conda', 'rattler', 'pip'];
  commandNames.forEach((name: string) => {
    if (code.includes(`%${name} ${command}`)) {
      code = code.replace(`%${name} ${command}`, '');
    }
  });

  return code;
}

/**
 * Detects whether the line has commands
 *
 * @param {string} code - The command line which should be parsed.
 * @returns {string} - True if code has a command
 */
function hasCommand(code: string): any {
  const commands = {
    remove: 'micromamba | un | mamba | conda | rattler',
    uninstall: 'pip',
    install: 'micromamba | un | mamba | conda | rattler | pip',
    list: 'micromamba | un | mamba | conda | rattler'
  };
  const result = Object.keys(commands).map(command => {
    const pattern = new RegExp(
      `^\\s*%(${commands[command]})\\s+${command}\\b`,
      'm'
    );
    const tmp = {};
    tmp[command] = pattern.test(code);
    console.log('tmp', tmp);
    return tmp;
  });
  return result;
}

/**
 * Parse conda installation command
 *
 * @param {string} input - The command line which should be parsed.
 * @returns {IInstallationCommandOptions} An object containing:
 *  - channels,
 *  - conda packages for installing,
 *  - pip packages for installing
 */
function parseCondaInstallCommand(input: string): IInstallationCommandOptions {
  const parts = input.split(' ');
  const channels: string[] = [];
  const specs: string[] = [];
  const pipSpecs: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part) {
      const j = i + 1;

      if (part === '-c' && j < parts.length && !parts[j].startsWith('-')) {
        channels.push(parts[j]);
        i++;
      } else {
        specs.push(part);
      }
    }
  }

  return {
    channels,
    specs,
    pipSpecs
  };
}

/**
 * Parse pip installation command
 *
 * @param {string} input - The command line which should be parsed.
 * @returns {IInstallationCommandOptions} An object containing:
 *  - channels,
 *  - conda packages for installing,
 *  - pip packages for installing
 */

function parsePipInstallCommand(input: string): IInstallationCommandOptions {
  const parts = input.split(' ');
  let skip = false;
  const limits = [
    '--index-url',
    '.whl',
    'tar.gz',
    '--extra-index-url',
    'http',
    'https',
    'git',
    './',
    '-r',
    '--extra-index-url'
  ];

  const flags = [
    '--upgrade',
    '--pre',
    '--no-cache-dir',
    '--user',
    '--upgrade',
    '--no-deps'
  ];

  const pipSpecs: string[] = [];

  limits.map((options: string) => {
    if (input.includes(options)) {
      skip = true;
    }
  });
  if (!skip) {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part) {
        if (!flags.includes(part)) {
          pipSpecs.push(part);
        }
      }
    }
  }

  return {
    channels: [],
    specs: [],
    pipSpecs
  };
}

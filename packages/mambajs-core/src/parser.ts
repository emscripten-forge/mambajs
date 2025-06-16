import { ILogger } from './helper';

export interface IParsedCommand {
  type: CommandsName;
  data: IInstallationCommandOptions | IUninstallationCommandOptions | null;
}

export type CommandsName = 'install' | 'list' | 'remove' | 'uninstall';

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
  env?: string[];
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
 * @param {string} input - The raw command-line input string to be parsed.
 * @param {ILogger} logger - The logger
 * @returns {ICommands} An object containing:
 *  - parsed installation options,
 *  - run command code,
 *  - and a list flag indicating whether a list command was detected.
 */
export function parse(input: string, logger?: ILogger): ICommandData {
  let result: ICommandData = {
    commands: [],
    run: input
  };

  const codeLines = input.split('\n');
  if (codeLines.length > 1) {
    result = { ...parseLines(codeLines, logger) };
  } else {
    if (hasCommand(input)['list']) {
      const command: IParsedCommand = {
        type: 'list',
        data: null
      };

      result = {
        commands: [command],
        run: ''
      };
    } else {
      const parsedData = { ...parseCommand(input, logger) };
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
 * Parses one row of code and detects whether it is conda or pip command.
 *
 * @param {string} input - The raw command-line input string to be parsed.
 * @param {ILogger} logger - The logger
 * @returns {IParsedCommands} An object containing:
 *  - parsed installation options,
 *  - run command code
 */
function parseCommand(
  input: string,
  logger?: ILogger
): {
  command: IParsedCommand | null;
  run: string;
} {
  const run = input;
  let result: {
    command: IParsedCommand | null;
    run: string;
  } = {
    command: null,
    run
  };
  const isCommand = hasCommand(input);
  if (isCommand.install) {
    result = parseInstallCommand(input, logger);
  } else if (isCommand.remove || isCommand.uninstall) {
    result = parseRemoveCommand(input, logger);
  }
  return result;
}

/**
 * Parses remove commands.
 *
 * @param {string} input - The command line which should be parsed.
 * @param {ILogger} [logger] - The logger.
 * @returns {{ command: IParsedCommand | null, run: string }} An object containing:
 *  - parsed remove options (`command`),
 *  - the raw command to run (`run`).
 */
function parseRemoveCommand(
  input: string,
  logger?: ILogger
): {
  command: IParsedCommand | null;
  run: string;
} {
  const run = input;
  let isPipCommand = false;

  if (input.includes('%pip uninstall')) {
    isPipCommand = true;
  }
  if (isPipCommand) {
    input = replaceCommandHeader(input, 'uninstall');
  } else {
    input = replaceCommandHeader(input, 'remove');
  }

  const command: IParsedCommand = {
    type: 'remove',
    data: {
      specs: [],
      env: []
    }
  };

  if (input) {
    if (isPipCommand) {
      command.data = getPipUnInstallParameters(input, logger);
      command.type = 'uninstall';
    } else {
      command.data = getCondaRemoveCommandParameters(input, logger);
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
 * Parses conda remove command and returns packages which should be deleted and from what environments.
 *
 * @param {string} input - The command line which should be parsed.
 * @param {ILogger} [logger] - The logger.
 * @returns {IUninstallationCommandOptions} An object containing:
 *  - parsed specs,
 *  - parsed environment.
 */
function getCondaRemoveCommandParameters(
  input: string,
  logger?: ILogger
): IUninstallationCommandOptions {
  const parts = input.split(' ');
  const specs: string[] = [];
  const env: string[] = [];
  const limits = ['-all', '--override-frozen', '--keep-env', '--dev'];
  let skip = false;
  let envFlags = ['-n', '--name', '-p', '--prefix'];

  limits.map((options: string) => {
    if (input.includes(options)) {
      skip = true;
    }
  });
  if (!skip) {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part) {
        const j = i + 1;
        if (
          envFlags.includes(part) &&
          j < parts.length &&
          !parts[j].startsWith('-')
        ) {
          env.push(parts[j]);
          i++;
        } else {
          specs.push(part);
        }
      }
    }
  } else {
    logger?.log('The command format is not supported');
  }

  return {
    specs,
    env
  };
}

/**
 * Parses installation commands.
 *
 * @param {string} input - The command line which should be parsed.
 * @param {ILogger} [logger] - The logger.
 * @returns {{ command: IParsedCommand | null, run: string }} An object containing:
 *  - parsed installation options (`command`),
 *  - the raw command to run (`run`).
 */

function parseInstallCommand(
  input: string,
  logger?: ILogger
): {
  command: IParsedCommand | null;
  run: string;
} {
  const run = input;
  let isPipCommand = false;

  if (input.includes('%pip install')) {
    isPipCommand = true;
  }

  input = replaceCommandHeader(input, 'install');
  const command: IParsedCommand = {
    type: 'install',
    data: {
      channels: [],
      specs: [],
      pipSpecs: []
    }
  };

  if (input) {
    if (isPipCommand) {
      command.data = parsePipInstallCommand(input, logger);
    } else {
      command.data = parseCondaInstallCommand(input);
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
 * @param {ILogger} logger - the logger
 * @returns {ICommands} An object containing:
 *  - parsed installation options,
 *  - run command code,
 *  - and a list flag indicating whether a list command was detected.
 */

function parseLines(codeLines: string[], logger?: ILogger): ICommandData {
  const runCommands: string[] = [];
  const commands: IParsedCommand[] = [];
  codeLines.forEach((line: string) => {
    const isCommand = hasCommand(line);
    if (isCommand['install'] || isCommand['remove'] || isCommand['uninstall']) {
      const { command } = { ...parseCommand(line, logger) };
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
 * Detects whether the line has commands
 * and replace the pattern '[commandNames] [command]' for futher calculations
 *
 * @param {string} input - The command line which should be parsed.
 * @returns {string} - Can be as part of conda installation command and as code
 */
function replaceCommandHeader(input: string, command: string): string {
  const commandNames = ['micromamba', 'un', 'mamba', 'conda', 'rattler', 'pip'];
  commandNames.forEach((name: string) => {
    if (input.includes(`%${name} ${command}`)) {
      input = input.replace(`%${name} ${command}`, '');
    }
  });

  return input;
}

/**
 * Detects whether the line has commands
 *
 * @param {string} input - The command line which should be parsed.
 * @returns {object} - Includes the dictionary of command type flags, where which of them can be true or false
 */
function hasCommand(input: string): any {
  const commands = {
    remove: 'micromamba|un|mamba|conda|rattler',
    uninstall: 'pip',
    install: 'micromamba|un|mamba|conda|rattler|pip',
    list: 'micromamba|un|mamba|conda|rattler'
  };
  const result = {};
  Object.keys(commands).forEach(command => {
    const pattern = new RegExp(
      `^\\s*%(${commands[command]})\\s+${command}\\b`,
      'm'
    );
    result[command] = pattern.test(input);
  });
  return result;
}

/**
 * Parses conda installation command
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
 * Parses pip installation command
 *
 * @param {string} input - The command line which should be parsed.
 * @param {ILogger} logger - The logger
 * @returns {IInstallationCommandOptions} An object containing:
 *  - channels,
 *  - conda packages for installing,
 *  - pip packages for installing
 */

function parsePipInstallCommand(
  input: string,
  logger?: ILogger
): IInstallationCommandOptions {
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

  const pipSpecs: string[] = getPipSpecs(input, limits, flags, logger);
  return {
    channels: [],
    specs: [],
    pipSpecs
  };
}

/**
 * Parses pip uninstall command
 *
 * @param {string} input - The command line which should be parsed.
 * @param {ILogger} logger - The logger
 * @returns {IUninstallationCommandOptions} An object containing:
 *  - specs is the array of package name that should be removed,
 *  - env which is the name of the environment where packages should be removed from
 */

function getPipUnInstallParameters(
  input: string,
  logger?: ILogger
): IUninstallationCommandOptions {
  const limits = ['-r'];

  const flags = [
    '-y',
    '--yes',
    '--root-user-action',
    '--break-system-packages'
  ];

  const specs: string[] = getPipSpecs(input, limits, flags, logger);

  return {
    specs,
    env: []
  };
}

/**
 * Parses pip command and returns pip specs
 *
 * @param {string} input - The command line which should be parsed.
 * @param {string[]} limits - Command flags which are not supported for a pip command
 * @param {string[]} flags - Command flags which may be supported
 * @param {ILogger} logger - The logger
 * @returns {string[]} An array of pip specs
 */
function getPipSpecs(
  input: string,
  limits: string[],
  flags: string[],
  logger?: ILogger
): string[] {
  const parts = input.split(' ');
  let skip = false;
  const specs: string[] = [];

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
          specs.push(part);
        }
      }
    }
  } else {
    logger?.log('The command format is not supported');
  }
  return specs;
}

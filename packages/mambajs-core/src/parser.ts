export interface IParsedCommand {
  type: CommandsName;
  data:
    | IInstallationCommandOptions
    | IUninstallationCommandOptions
    | IListCommandOptions;
}

export const CONDA_ALIASES = [
  'micromamba',
  'un',
  'mamba',
  'conda',
  'rattler'
] as const;
export type TCondaAliases = (typeof CONDA_ALIASES)[number];

export type CommandsName = 'install' | 'list' | 'remove';

export interface ICommandData {
  commands: IParsedCommand[];
  run: string;
}

export interface IInstallationCommandOptions {
  type: 'conda' | 'pip';
  specs: string[];
  channels: string[];
}

export interface IUninstallationCommandOptions {
  type: 'conda' | 'pip';
  specs: string[];
}

export interface IListCommandOptions {
  type: 'conda' | 'pip';
}

/**
 * Parses a command-line string and classifies it into installation commands,
 * runnable code, or conda list operations.
 *
 * - If the code is a list command, it sets the `list` flag to true.
 * - If the code contains conda or pip installation command, then it tries to parse it
 * - Otherwise code will be executed as it is
 *
 * @param {string} input - The raw command-line input string to be parsed.
 * @returns {ICommands} An object containing:
 *  - parsed installation options,
 *  - run command code,
 *  - and a list flag indicating whether a list command was detected.
 */
export function parse(input: string): ICommandData {
  return { ...parseLines(input.split('\n')) };
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
    const commandLine = parseCommandLine(line);

    if (!commandLine) {
      runCommands.push(line);
      return;
    }

    commands.push(commandLine);
  });

  return {
    commands,
    run: runCommands.join('\n')
  };
}

/**
 * Parse a command line
 *
 * @param line - The command line which should be parsed.
 * @returns - The command or null if it's not a supported magic
 */
function parseCommandLine(line: string): IParsedCommand | null {
  let parsedCommand: IParsedCommand | null = null;

  const commandLine = line.split(' ').filter(val => !!val);

  if (!commandLine[0]) {
    return null;
  }

  let command: 'conda' | 'pip' | null = null;
  const alias =
    commandLine[0].startsWith('%') || commandLine[0].startsWith('!')
      ? commandLine[0].substring(1)
      : commandLine[0];
  if (CONDA_ALIASES.includes(alias as TCondaAliases)) {
    command = 'conda';
  } else if (alias === 'pip') {
    command = 'pip';
  } else {
    // It's probably an IPython magic, we let it run
    return null;
  }

  // We've done all the checks, we know for sure the type is correct
  parsedCommand = {
    type: commandLine[1] as 'install' | 'remove' | 'list',
    data: {
      type: command
    }
  };

  if (command === 'conda') {
    if (!['install', 'remove', 'list'].includes(commandLine[1])) {
      throw new Error(`Unknown ${alias} command '${commandLine[1]}'`);
    }
  } else {
    if (!['install', 'uninstall', 'list'].includes(commandLine[1])) {
      throw new Error(`Unknown ${alias} command '${commandLine[1]}'`);
    }

    if (commandLine[1] === 'uninstall') {
      parsedCommand.type = 'remove';
    }
  }

  const commandParameters = commandLine.slice(2);
  switch (parsedCommand.type) {
    case 'install': {
      if (parsedCommand.data.type === 'pip') {
        parsedCommand.data = parsePipInstallCommand(commandParameters);
      } else {
        parsedCommand.data = parseCondaInstallCommand(commandParameters);
      }
      break;
    }
    case 'remove': {
      if (parsedCommand.data.type === 'pip') {
        parsedCommand.data = getPipUninstallParameters(commandParameters);
      } else {
        parsedCommand.data = getCondaRemoveCommandParameters(commandParameters);
      }
      break;
    }
    case 'list': {
      // List does not take arguments
      break;
    }
  }

  return parsedCommand;
}

/**
 * Parses conda installation command
 *
 * @param parameters - The command line which should be parsed.
 * @returns {IInstallationCommandOptions} An object containing:
 *  - channels,
 *  - conda packages for installing,
 *  - pip packages for installing
 */
function parseCondaInstallCommand(
  parameters: string[]
): IInstallationCommandOptions {
  const channels: string[] = [];
  const specs: string[] = [];
  for (let i = 0; i < parameters.length; i++) {
    const parameter = parameters[i];

    const j = i + 1;

    if (
      (parameter === '-c' || parameter === '--channel') &&
      j < parameters.length &&
      !parameters[j].startsWith('-')
    ) {
      channels.push(parameters[j]);
      i++;
    } else {
      specs.push(parameter);
    }
  }

  return {
    channels,
    specs,
    type: 'conda'
  };
}

/**
 * Parses pip installation command
 *
 * @param parameters - The command line which should be parsed.
 * @returns {IInstallationCommandOptions} An object containing:
 *  - channels,
 *  - conda packages for installing,
 *  - pip packages for installing
 */
function parsePipInstallCommand(
  parameters: string[]
): IInstallationCommandOptions {
  const limits = [
    '--index-url',
    'git+',
    '.whl',
    'tar.gz',
    '--extra-index-url',
    '-r'
  ];

  const flags = ['--upgrade', '--pre', '--no-cache-dir', '--user', '--no-deps'];

  return {
    channels: [],
    specs: getPipSpecs(parameters, limits, flags),
    type: 'pip'
  };
}

/**
 * Parses pip uninstall command
 *
 * @param parameters - The command line which should be parsed.
 * @returns {IUninstallationCommandOptions} An object containing:
 *  - specs is the array of package name that should be removed,
 *  - env which is the name of the environment where packages should be removed from
 */
function getPipUninstallParameters(
  parameters: string[]
): IUninstallationCommandOptions {
  const limits = ['-r'];

  const flags = [
    '-y',
    '--yes',
    '--root-user-action',
    '--break-system-packages'
  ];

  const specs: string[] = getPipSpecs(parameters, limits, flags);

  return {
    specs,
    type: 'pip'
  };
}

/**
 * Parses pip command and returns pip specs
 *
 * @param parameters - The command line which should be parsed.
 * @param {string[]} limits - Command flags which are not supported for a pip command
 * @param {string[]} flags - Command flags which may be supported
 * @returns {string[]} An array of pip specs
 */
function getPipSpecs(
  parameters: string[],
  limits: string[],
  flags: string[]
): string[] {
  const specs: string[] = [];

  parameters.map(parameter => {
    if (
      limits.includes(parameter) ||
      limits.reduce((acc, limit) => acc || parameter.includes(limit), false)
    ) {
      throw new Error(`Unsupported option '${parameter}'`);
    }

    if (!flags.includes(parameter)) {
      specs.push(parameter);
    }
  });

  return specs;
}

/**
 * Parses conda remove command and returns packages which should be deleted.
 *
 * @param parameters - The command line which should be parsed.
 * @returns {IUninstallationCommandOptions} An object containing:
 *  - parsed specs,
 */
function getCondaRemoveCommandParameters(
  parameters: string[]
): IUninstallationCommandOptions {
  const specs: string[] = [];

  const limits = [
    '-n',
    '--name',
    '-p',
    '--prefix',
    '-all',
    '--override-frozen',
    '--keep-env',
    '--dev'
  ];

  parameters.map(parameter => {
    if (limits.includes(parameter)) {
      throw new Error(`Unsupported option ${parameter}`);
    }

    specs.push(parameter);
  });

  return {
    specs,
    type: 'conda'
  };
}

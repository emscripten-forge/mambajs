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

  if (!commandLine[0] || !commandLine[0].startsWith('%')) {
    return null;
  }

  let command: 'conda' | 'pip' | null = null;
  if (CONDA_ALIASES.includes(commandLine[0].split('%')[1] as TCondaAliases)) {
    command = 'conda';
  } else if (commandLine[0].split('%')[1] === 'pip') {
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
      throw new Error(`Unknown conda command ${commandLine[1]}`);
    }
  } else {
    if (!['install', 'uninstall', 'list'].includes(commandLine[1])) {
      throw new Error(`Unknown pip command ${commandLine[1]}`);
    }

    if (commandLine[1] === 'uninstall') {
      parsedCommand.type = 'remove';
    }
  }

  // TODO Make sub parsers take the list so it doesn't have to re-split
  const commandParameters = commandLine.slice(2).join(' ');
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
    type: 'conda'
  };
}

/**
 * Parses pip installation command
 *
 * @param {string} input - The command line which should be parsed.
 * @returns {IInstallationCommandOptions} An object containing:
 *  - channels,
 *  - conda packages for installing,
 *  - pip packages for installing
 */

function parsePipInstallCommand(input: string): IInstallationCommandOptions {
  const limits = ['--index-url', '.whl', 'tar.gz', '--extra-index-url', '-r'];

  const flags = [
    '--upgrade',
    '--pre',
    '--no-cache-dir',
    '--user',
    '--upgrade',
    '--no-deps'
  ];

  return {
    channels: [],
    specs: getPipSpecs(input, limits, flags),
    type: 'pip'
  };
}

/**
 * Parses pip uninstall command
 *
 * @param {string} input - The command line which should be parsed.
 * @returns {IUninstallationCommandOptions} An object containing:
 *  - specs is the array of package name that should be removed,
 *  - env which is the name of the environment where packages should be removed from
 */

function getPipUninstallParameters(
  input: string
): IUninstallationCommandOptions {
  const limits = ['-r'];

  const flags = [
    '-y',
    '--yes',
    '--root-user-action',
    '--break-system-packages'
  ];

  const specs: string[] = getPipSpecs(input, limits, flags);

  return {
    specs,
    type: 'pip'
  };
}

/**
 * Parses pip command and returns pip specs
 *
 * @param {string} input - The command line which should be parsed.
 * @param {string[]} limits - Command flags which are not supported for a pip command
 * @param {string[]} flags - Command flags which may be supported
 * @returns {string[]} An array of pip specs
 */
function getPipSpecs(
  input: string,
  limits: string[],
  flags: string[]
): string[] {
  const parts = input.split(' ');
  const specs: string[] = [];

  limits.map((option: string) => {
    if (input === option) {
      throw new Error(`Unsupported option ${option}`);
    }
  });

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part) {
      if (!flags.includes(part)) {
        specs.push(part);
      }
    }
  }

  return specs;
}

/**
 * Parses conda remove command and returns packages which should be deleted.
 *
 * @param {string} input - The command line which should be parsed.
 * @returns {IUninstallationCommandOptions} An object containing:
 *  - parsed specs,
 */
function getCondaRemoveCommandParameters(
  input: string
): IUninstallationCommandOptions {
  const parts = input.split(' ');
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

  limits.map((option: string) => {
    if (input === option) {
      throw new Error(`Unsupported option ${option}`);
    }
  });

  for (const part of parts) {
    if (part) {
      specs.push(part);
    }
  }

  return {
    specs,
    type: 'conda'
  };
}

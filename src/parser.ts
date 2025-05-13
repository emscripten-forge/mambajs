export interface IParsedCommand {
  type: CommandsName;
  data: IInstallationCommandOptions | null;
}

type CommandsName = 'install' | 'list';

export interface ICommandData {
  commands: IParsedCommand[];
  run: string;
}

export interface IInstallationCommandOptions {
  channels: string[];
  specs: string[];
  pipSpecs: string[];
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
    if (hasCondaListCommand(code)) {
      let command: IParsedCommand = {
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
  let isPipCommand = false;
  const isInstallCommand = hasInstallCommand(code);
  code = isInstallCommand ? replaceCommandHeader(code) : code;
  let command: IParsedCommand = {
    type: 'install',
    data: {
      channels: [],
      specs: [],
      pipSpecs: []
    }
  };

  if (isInstallCommand && code.includes('%pip install')) {
    code = code.replace('%pip install', '');
    isPipCommand = true;
  }

  if (isInstallCommand && code) {
    if (isPipCommand) {
      command.data = parsePipCommand(code);
    } else {
      command.data = parseCondaCommand(code);
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
    const isInstallCommand = hasInstallCommand(line);
    if (isInstallCommand) {
      const { command } = { ...parseCommand(line) };
      if (command) {
        commands.push(command);
      }
    } else if (hasCondaListCommand(line)) {
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
function replaceCommandHeader(code: string): string {
  const commandNames = ['micromamba', 'un', 'mamba', 'conda', 'rattler'];
  commandNames.forEach((name: string) => {
    if (code.includes(`%${name} install`)) {
      code = code.replace(`%${name} install`, '');
    }
  });

  return code;
}

/**
 * Detects whether the line has conda installation commands
 *
 * @param {string} code - The command line which should be parsed.
 * @returns {boolean} - True if it is a conda installation command
 */
function hasInstallCommand(code: string): boolean {
  let isCommand = false;
  const commandNames = ['micromamba', 'un', 'mamba', 'conda', 'rattler', 'pip'];
  const pattern = new RegExp(
    `^\\s*%(${commandNames.join('|')})\\s+install\\b`,
    'm'
  );

  isCommand = pattern.test(code);
  return isCommand;
}

/**
 * Detects whether the line is to list installed packages
 *
 * @param {string} code - The command line which should be parsed.
 * @returns {boolean} - True if it is list command
 */
function hasCondaListCommand(code: string): boolean {
  let isCondaListCommand = false;
  const commandNames = ['micromamba', 'un', 'mamba', 'conda', 'rattler'];
  commandNames.forEach((name: string) => {
    if (code === `%${name} list`) {
      isCondaListCommand = true;
    }
  });

  return isCondaListCommand;
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
function parseCondaCommand(input: string): IInstallationCommandOptions {
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

function parsePipCommand(input: string): IInstallationCommandOptions {
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

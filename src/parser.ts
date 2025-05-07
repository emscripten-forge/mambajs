export interface IParsedCommands {
  install: IInstallationCommandOptions;
  run: string;
}

export interface IInstallationCommandOptions {
  channels?: string[];
  specs?: string[];
  pipSpecs?: string[];
  isPipCommand?: boolean;
}

export interface ICommands extends IParsedCommands {
  install: IInstallationCommandOptions,
  run: string;
  list: boolean[];
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
export function parse(code: string): ICommands {
  let result: ICommands = {
    install: {},
    run: code,
    list: [false]
  };
  const codeLines = code.split('\n');
  if (codeLines.length > 1) {
    result = { ...parseLines(codeLines) };
  } else {
    if (hasCondaListCommand(code)) {
      result = { install: result.install, run: '', list: [true] };
    } else {
      result = { ...parseCommand(code), list: [false] };
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
function parseCommand(code: string): IParsedCommands {
  const run = code;
  let isPipCommand = false;
  const isCondaCommand = hasCondaInstallCommand(code);
  code = isCondaCodeLine(code);

  if (!isCondaCommand && code.includes('%pip install')) {
    code = code.replace('%pip install', '');
    isPipCommand = true;
  }
  let result: IInstallationCommandOptions = {
    channels: [],
    specs: [],
    pipSpecs: []
  };
  if ((isCondaCommand || isPipCommand) && code) {
    if (isPipCommand) {
      result = parsePipCommand(code);
    } else {
      result = parseCondaCommand(code);
    }

    return { install: { ...result, isPipCommand }, run: '' };
  } else {
    return { install: {}, run };
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

function parseLines(codeLines: string[]): ICommands {
  const installCommands: string[] = [];
  const runCommands: string[] = [];
  const listCommand: boolean[] = [];

  let channels: string[] = [];
  let specs: string[] = [];
  let pipSpecs: string[] = [];
  codeLines.forEach((line: string) => {
    if (hasCondaInstallCommand(line) || hasPipCommand(line)) {
      installCommands.push(line);
    } else if (hasCondaListCommand(line)) {
      listCommand.push(true);
    } else {
      runCommands.push(line);
    }
  });

  if (installCommands.length) {
    let tmpResult: IParsedCommands = {
      install: {
        channels: [],
        specs: [],
        pipSpecs: []
      },
      run: ''
    };
    installCommands.forEach((line: string) => {
      tmpResult = { ...parseCommand(line) };
      channels = tmpResult.install.channels
        ? [...channels, ...tmpResult.install.channels]
        : channels;
      specs = tmpResult.install.specs
        ? [...specs, ...tmpResult.install.specs]
        : specs;
      pipSpecs = tmpResult.install.pipSpecs
        ? [...pipSpecs, ...tmpResult.install.pipSpecs]
        : pipSpecs;
    });
  }

  return {
    install: { channels, specs, pipSpecs },
    run: runCommands ? runCommands.join('\n') : '',
    list: listCommand ? listCommand : [false]
  };
}

/**
 * Detects whether the line has conda installation commands
 * and replace the patter '[commandNames] install' for futher calculations
 *
 * @param {string} code - The command line which should be parsed.
 * @returns {string} - Can be as part of conda installation command and as code
 */
function isCondaCodeLine(code: string): string {
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
function hasCondaInstallCommand(code: string): boolean {
  let isCondaCommand = false;
  const commandNames = ['micromamba', 'un', 'mamba', 'conda', 'rattler'];
  commandNames.forEach((name: string) => {
    if (code.includes(`%${name} install`)) {
      isCondaCommand = true;
    }
  });

  return isCondaCommand;
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
 * Detects whether the line has pip installation commands
 *
 * @param {string} code - The command line which should be parsed.
 * @returns {boolean} - True if it is a pip installation command
 */
function hasPipCommand(code: string): boolean {
  let isPipCommand = false;
  if (code.includes('%pip install')) {
    isPipCommand = true;
  }

  return isPipCommand;
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

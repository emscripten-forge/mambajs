# Mambajs

**A JavaScript/TypeScript toolbox for manipulating conda environment definitions in WebAssembly environments**

[![npm version](https://badge.fury.io/js/@emscripten-forge%2Fmambajs.svg)](https://www.npmjs.com/package/@emscripten-forge/mambajs)

## Table of Contents

- [What is Mambajs?](#what-is-mambajs)
- [What Mambajs is NOT](#what-mambajs-is-not-yet)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Filesystem Operations](#filesystem-operations)
- [Working with Lock Files](#working-with-lock-files)
- [Advanced Usage](#advanced-usage)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Development](#development)
- [Platform Support](#platform-support)

## What is Mambajs?

Mambajs is a powerful toolbox designed for manipulating conda environment definitions, with first-class support for:

- **Conda package management**: Create, solve, install, and remove conda packages
- **Pip package support**: Install and manage pip packages alongside conda packages
- **Emscripten/WebAssembly environments**: Built with `emscripten-wasm32` platform in mind
- **Filesystem operations**: Tools for installing/uninstalling packages into an Emscripten FS
- **Python environment bootstrapping**: Spawn Python interpreters and load shared libraries
- **Lock file management**: Generate and manipulate conda lock definitions

Backed by [rattler](https://github.com/conda-incubator/rattler) for conda package solving and an in-house PyPi package manager.

## What Mambajs is NOT (yet)

- **Not a replacement** for micromamba or rattler CLIs
- **Does not install packages for you**: The `install`/`remove`/`pipInstall`/`pipUninstall` are "lock file focused" functions that manipulate conda lock definitions (lock input → lock output). They don't actually install/uninstall packages - it's up to you to handle the actual package installation where and how you want. We do provide some utility functions to install packages in an Emscripten FS though.

## Installation

```bash
npm install @emscripten-forge/mambajs
```

Or with yarn:

```bash
yarn add @emscripten-forge/mambajs
```

## Quick Start

### Basic Environment Creation

```typescript
import { create } from '@emscripten-forge/mambajs';

const yml = `
channels:
  - https://prefix.dev/emscripten-forge-dev
  - https://prefix.dev/conda-forge
dependencies:
  - python=3.11
  - numpy
  - pandas
  - pip:
    - matplotlib
    - ipywidgets
`;

// Create environment from YAML definition
const lock = await create({yml});
console.log('Created environment with packages:', Object.keys(lock.packages));
```



### Managing Existing Environments

```typescript
import { install, remove, pipInstall, pipUninstall } from '@emscripten-forge/mambajs';

// Install new conda packages
const updatedEnv = await install(
  ['scipy', 'matplotlib'], // packages to install
  currentLock,              // current environment lock
  ['conda-forge'],          // additional channels (optional)
  console                   // logger (optional)
);

// Remove conda packages
const envAfterRemoval = await remove(
  ['scipy'],    // packages to remove
  updatedEnv,   // current environment
  console       // logger (optional)
);

// Install pip packages
const envWithPip = await pipInstall(
  ['requests>=2.28.0', 'bqplot'],
  currentLock,
  console
);

// Uninstall pip packages
const envWithoutPip = await pipUninstall(
  ['requests'],
  envWithPip,
  console
);
```

## Filesystem Operations

### Bootstrap Environment in Emscripten FS

```typescript
import {
  bootstrapEmpackPackedEnvironment,
  installPackagesToEmscriptenFS
} from '@emscripten-forge/mambajs';



// Install packages to filesystem
const installedData = await installPackagesToEmscriptenFS({
  packages: {
    packages: lock.packages,
    pipPackages: lock.pipPackages
  },
  channels: lock.channelInfo,
  Module: EmscriptenModule,
  logger: console
});

console.log('Shared libraries:', installedData.sharedLibs);
```

### Python Environment Bootstrap

```typescript
import { bootstrapPython, loadSharedLibs } from '@emscripten-forge/mambajs';

// Bootstrap Python runtime
await bootstrapPython({
  pythonVersion: [3, 11],
  prefix: '/opt/conda',
  Module: EmscriptenModule,
  verbose: true
});

// Load shared libraries
await loadSharedLibs({
  sharedLibs: installedData.sharedLibs,
  prefix: '/opt/conda',
  Module: EmscriptenModule,
  logger: console
});
```

## Working with Lock Files

```typescript
import { ILock, ISolvedPackage } from '@emscripten-forge/mambajs';

// Access package information
const lock: ILock = await create({yml});

// Iterate through conda packages
for (const [filename, pkg] of Object.entries(lock.packages)) {
  console.log(`${pkg.name}@${pkg.version} from ${pkg.channel}`);
}

// Iterate through pip packages
for (const [filename, pkg] of Object.entries(lock.pipPackages)) {
  console.log(`${pkg.name}@${pkg.version} from ${pkg.registry}`);
}

// Access channel information
console.log('Channels:', lock.channels);
console.log('Platform:', lock.platform); // 'emscripten-wasm32'
```

## Advanced Usage

### Custom Logger

```typescript
import { ILogger } from '@emscripten-forge/mambajs';

class CustomLogger implements ILogger {
  log(...msg: any[]) {
    console.log('[INFO]', ...msg);
  }
  warn(...msg: any[]) {
    console.warn('[WARN]', ...msg);
  }
  error(...msg: any[]) {
    console.error('[ERROR]', ...msg);
  }
}

const result = await solve({
  ymlOrSpecs: ['python', 'numpy'],
  logger: new CustomLogger()
});
```

### Environment Diff

```typescript
import { showEnvironmentDiff } from '@emscripten-forge/mambajs';

const oldEnv = await create({yml: oldYml});
const newEnv = await create({yml: newYml});

// Show what changed between environments
showEnvironmentDiff(oldEnv, newEnv, console);
```

## API Reference

### Core Functions

- **`solve(options)`**: Core solving function with full control
- **`create({yml, platform?, logger?})`**: Create environment from environment.yml
- **`install(specs, env, channels?, logger?)`**: Install conda packages
- **`remove(packages, env, logger?)`**: Remove conda packages
- **`pipInstall(specs, env, logger?)`**: Install pip packages
- **`pipUninstall(packages, env, logger?)`**: Uninstall pip packages

### Filesystem Operations

- **`bootstrapEmpackPackedEnvironment(options)`**: Bootstrap from empack metadata
- **`installPackagesToEmscriptenFS(options)`**: Install packages to filesystem
- **`removePackagesFromEmscriptenFS(options)`**: Remove packages from filesystem
- **`updatePackagesInEmscriptenFS(options)`**: Update packages in filesystem

### Python & Shared Libraries

- **`bootstrapPython(options)`**: Bootstrap Python runtime
- **`loadSharedLibs(options)`**: Load shared libraries
- **`getPythonVersion(lock)`**: Extract Python version from the lock

### Utilities

- **`showPackagesList(packages, logger)`**: Display package list
- **`showEnvironmentDiff(old, new, logger)`**: Show environment changes
- **`packageNameFromSpec(spec)`**: Extract package name from spec

## Project Structure

This is a monorepo managed with Lerna:

- **`@emscripten-forge/mambajs`**: Main package with high-level API
- **`@emscripten-forge/mambajs-core`**: Core utilities and filesystem operations

## Development

```bash
# Install dependencies
yarn install

# Build all packages
yarn build

# Run tests
yarn test

# Lint code
yarn lint
```

### Release Process

```bash
yarn
npx lerna version --no-private
# Push main branch and tag
yarn run build
# For each packages/*
npm publish
```

## Platform Support

Mambajs is designed primarily for WebAssembly/Emscripten environments but can work in Node.js for lock file manipulation.

**Default Platform**: `emscripten-wasm32`
**Default Channels**: `emscripten-forge` (https://prefix.dev/emscripten-forge-dev), `conda-forge` (https://prefix.dev/conda-forge)

## License

MIT

## Contributing

Contributions are welcome! This project is still in active development and APIs may change quickly.

## Related Projects

- [rattler](https://github.com/conda-incubator/rattler) - Fast conda package manager (Rust)
- [emscripten-forge](https://github.com/emscripten-forge) - Conda packages for Emscripten
- [micromamba](https://github.com/mamba-org/mamba) - Fast conda package manager

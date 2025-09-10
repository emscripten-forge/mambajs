# Mambajs - Conda Package Solver for JavaScript

Mambajs is a TypeScript/JavaScript library that enables solving conda environments and pip packages in web browsers. It consists of two main packages in a Lerna monorepo with Yarn workspaces.

**Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the information here.**

## Quick Start (Complete Setup from Fresh Clone)

```bash
# 1. Create and activate conda environment (2-3 minutes)
conda env create -f environment.yml
eval "$(conda shell.bash hook)" && conda activate mambajs

# 2. Install dependencies (30-35 seconds)
yarn install

# 3. Build the project (12-15 seconds)  
yarn run build

# 4. Run tests (8-12 seconds)
yarn run test

# 5. Check linting (1-2 seconds)
yarn run lint:check
```

## Working Effectively

### Environment Setup
- **Install conda environment**: `conda env create -f environment.yml` -- takes 2-3 minutes. NEVER CANCEL. Set timeout to 5+ minutes.
- **Activate environment**: `eval "$(conda shell.bash hook)" && conda activate mambajs`
- **Install dependencies**: `yarn install` -- takes 30-35 seconds. NEVER CANCEL. Set timeout to 2+ minutes.

### Build Process
- **Full build**: `yarn run build` -- takes 12-15 seconds. NEVER CANCEL. Set timeout to 2+ minutes.

### Testing
- **Run all tests**: `yarn run test` -- takes 8-12 seconds. NEVER CANCEL. Set timeout to 5+ minutes.
- **Expected test behavior**: All tests should pass consistently.
- **Test compilation**: Tests are TypeScript compiled to `unittests/testlib/` then executed with Node.js.

### Linting and Code Quality
- **Check linting**: `yarn run lint:check` -- takes 1-2 seconds. NEVER CANCEL. Set timeout to 1+ minute.
- **Fix linting**: `yarn run lint` -- takes 3-5 seconds. NEVER CANCEL. Set timeout to 1+ minute.

## Validation

### CI Pipeline Validation
- Always run the complete CI sequence locally before pushing:
  1. `yarn install`
  2. `yarn run lint:check` 
  3. `yarn run build`
  4. `yarn run test`

## Common Tasks

### Project Structure
The repository root contains:
```
.
├── README.md
├── package.json              # Root package with monorepo scripts
├── lerna.json               # Lerna configuration for monorepo
├── environment.yml          # Conda environment with nodejs/yarn
├── packages/
│   ├── mambajs/            # Main solver package
│   └── mambajs-core/       # Core utilities and types
├── unittests/              # Test suite with custom runner
├── tsconfig.json           # TypeScript configuration
├── .eslintrc.js           # ESLint configuration
└── .github/workflows/main.yml  # CI pipeline
```

### Package Details
- **@emscripten-forge/mambajs**: Main package with conda and pip solving capabilities
- **@emscripten-forge/mambajs-core**: Core utilities, types, and helper functions
- **Built output**: Each package generates `lib/` directory with JavaScript bundles and TypeScript declarations

### Key Files to Check When Making Changes
- Always check TypeScript compilation after editing `.ts` files
- Schema changes in `packages/mambajs-core/schema/` require rebuild to regenerate types
- ESBuild configurations are in `packages/*/esbuild.config.js`
- Test files are in `unittests/tests/` with custom runner in `unittests/runner.js`

## Known Issues and Workarounds

### Expected Warnings (Non-Breaking)
- **TypeScript version warning**: ESLint may warn about unsupported TypeScript version - this is non-breaking
- **Module type warnings**: Node.js may warn about module types when running tests - this is non-breaking

### Timing Expectations
- **Environment creation**: 2-3 minutes (includes downloading packages)
- **Dependency installation**: 30-35 seconds (yarn install)
- **Full build**: 12-15 seconds (both packages)
- **Linting**: 1-5 seconds depending on operation
- **Test suite**: 8-12 seconds

### Dependencies
- **Conda/micromamba**: Required for nodejs and yarn from conda-forge
- **Lerna**: Manages the monorepo workspace
- **ESBuild**: Fast JavaScript bundling
- **TypeScript**: Type checking and declaration generation
- **Custom test runner**: Located in `unittests/runner.js`

## Troubleshooting

### Build Issues
- If build fails, ensure conda environment is activated
- Check that all dependencies are installed with `yarn install`
- For schema generation issues, check `packages/mambajs-core/schema/` files

### Test Issues  
- If parser tests fail, check TypeScript compilation errors
- Test output files are in `unittests/testlib/` - clean with `rimraf unittests/testlib`

### Development Workflow
1. Activate conda environment: `eval "$(conda shell.bash hook)" && conda activate mambajs`
2. Install dependencies: `yarn install`
3. Make changes to TypeScript files
4. Build: `yarn run build`
5. Test: `yarn run test`
6. Lint: `yarn run lint:check`
7. Fix any linting issues: `yarn run lint`
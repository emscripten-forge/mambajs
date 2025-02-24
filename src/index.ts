import { initUntarJS, IUnpackJSAPI } from '@emscripten-forge/untarjs';
import { initEnv } from './conda-packages-solver';
import {
  getSharedLibs,
  IEmpackEnvMeta,
  IEmpackEnvMetaPkg,
  ILogger,
  ISolvedPackage,
  ISolvedPackages,
  saveFilesIntoEmscriptenFS,
  TSharedLibsMap,
  untarCondaPackage
} from './helper';
import { loadDynlibsFromPackage } from './dynload/dynload';
import { hasPipDependencies, solvePip } from './solverpip';

export * from './helper';

import coreWasm from './conda-packages-solver/core.wasm';
export const mambaWasm = coreWasm;

/**
 * Given a list of packages from a lock file, get the Python version
 * @param packages
 * @returns The Python version as a list of numbers if it is there
 */
export function getPythonVersion(
  packages: IEmpackEnvMetaPkg[] | ISolvedPackage[]
): number[] | undefined {
  let pythonPackage: IEmpackEnvMetaPkg | ISolvedPackage | undefined = undefined;
  for (let i = 0; i < packages.length; i++) {
    if (packages[i].name == 'python') {
      pythonPackage = packages[i];
      break;
    }
  }

  if (pythonPackage) {
    return pythonPackage.version.split('.').map(x => parseInt(x));
  }
}

export interface IBootstrapEmpackPackedEnvironmentOptions {
  /**
   * The empack lock file
   */
  empackEnvMeta: IEmpackEnvMeta;

  /**
   * The URL (CDN or similar) from which to download packages
   */
  pkgRootUrl: string;

  /**
   * The Emscripten Module
   */
  Module: any;

  /**
   * Whether to build in verbose mode, default to silent
   */
  verbose?: boolean;

  /**
   * Whether to install conda-meta for packages, default to False
   */
  generateCondaMeta?: boolean;

  /**
   * The untarjs API. If not provided, one will be initialized.
   */
  untarjs?: IUnpackJSAPI;
}

/**
 * Bootstrap a filesystem from an empack lock file. And return the installed shared libs.
 *
 * @param options
 * @returns The installed shared libraries as a TSharedLibs
 */
export const bootstrapEmpackPackedEnvironment = async (
  options: IBootstrapEmpackPackedEnvironmentOptions
): Promise<TSharedLibsMap> => {
  const { empackEnvMeta, pkgRootUrl, Module, verbose, generateCondaMeta } =
    options;

  let untarjs: IUnpackJSAPI;
  if (options.untarjs) {
    untarjs = options.untarjs;
  } else {
    const untarjsReady = initUntarJS();
    untarjs = await untarjsReady;
  }

  const sharedLibsMap: TSharedLibsMap = {};
  const pythonVersion = getPythonVersion(empackEnvMeta.packages);

  if (empackEnvMeta.packages.length) {
    await Promise.all(
      empackEnvMeta.packages.map(async pkg => {
        const url = pkg?.url ?? `${pkgRootUrl}/${pkg.filename}`;
        if (verbose) {
          console.log(`Install ${pkg.filename} taken from ${url}`);
        }

        const extractedPackage = await untarCondaPackage({
          url,
          untarjs,
          verbose,
          generateCondaMeta,
          pythonVersion
        });

        sharedLibsMap[pkg.name] = getSharedLibs(extractedPackage, '');

        saveFilesIntoEmscriptenFS(Module.FS, extractedPackage, '');
      })
    );
    await waitRunDependencies(Module);
  }

  return sharedLibsMap;
};

export interface IBootstrapPythonOptions {
  /**
   * The Python version as a list e.g. [3, 11]
   */
  pythonVersion: number[];

  /**
   * The environment prefix
   */
  prefix: string;

  /**
   * The Emscripten Module
   */
  Module: any;

  /**
   * Whether to build in verbose mode, default to silent
   */
  verbose?: boolean;
}

/**
 * Bootstrap Python runtime
 *
 * @param options
 */
export async function bootstrapPython(options: IBootstrapPythonOptions) {
  // Assuming these are defined by pyjs
  await options.Module.init_phase_1(
    options.prefix,
    options.pythonVersion,
    options.verbose
  );
  options.Module.init_phase_2(
    options.prefix,
    options.pythonVersion,
    options.verbose
  );
}

export interface ILoadSharedLibsOptions {
  /**
   * Shared libs to load
   */
  sharedLibs: TSharedLibsMap;

  /**
   * The environment prefix
   */
  prefix: string;

  /**
   * The Emscripten Module
   */
  Module: any;
}

export async function loadShareLibs(
  options: ILoadSharedLibsOptions
): Promise<void[]> {
  const { sharedLibs, prefix, Module } = options;

  const sharedLibsLoad: Promise<void>[] = [];

  for (const pkgName of Object.keys(sharedLibs)) {
    const packageShareLibs = sharedLibs[pkgName];

    if (packageShareLibs) {
      sharedLibsLoad.push(
        loadDynlibsFromPackage(prefix, pkgName, packageShareLibs, Module)
      );
    }
  }

  return await Promise.all(sharedLibsLoad);
}

export async function waitRunDependencies(Module: any): Promise<void> {
  const promise = new Promise<void>(r => {
    Module.monitorRunDependencies = n => {
      if (n === 0) {
        r();
      }
    };
  });
  Module.addRunDependency('dummy');
  Module.removeRunDependency('dummy');
  return promise;
}

export async function solve(
  yml: string,
  logger?: ILogger,
  locateWasm?: (file: string) => string
): Promise<{ condaPackages: ISolvedPackages; pipPackages: ISolvedPackages }> {
  const picomamba = await initEnv(logger, locateWasm);

  const condaPackages = await picomamba.solve(yml);
  let pipPackages: ISolvedPackages = {};

  if (hasPipDependencies(yml)) {
    if (!getPythonVersion(Object.values(condaPackages))) {
      const msg =
        'Cannot install pip dependencies without Python installed in the environment!';
      logger?.error(msg);
      throw msg;
    }

    logger?.log('');
    logger?.log('Process pip dependencies ...');

    pipPackages = await solvePip(yml, condaPackages, logger);
  }

  return {
    condaPackages,
    pipPackages
  };
}

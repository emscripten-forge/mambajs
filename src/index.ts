import { initUntarJS, IUnpackJSAPI } from '@emscripten-forge/untarjs';
import {
  TSharedLibs,
  TSharedLibsMap,
  IEmpackEnvMeta,
  installCondaPackage
} from './helper';
import { loadDynlibsFromPackage } from './dynload/dynload';

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
   * The untarjs API. If not provided, one will be initialized.
   */
  untarjs?: IUnpackJSAPI;
}

/**
 * Bootstrap a filesystem from an empack lock file
 *
 * @param options
 * @returns The installed shared libraries as a TSharedLibs
 */
export const bootstrapEmpackPackedEnvironment = async (options: IBootstrapEmpackPackedEnvironmentOptions): Promise<TSharedLibsMap> => {
  const { empackEnvMeta, pkgRootUrl, Module, verbose } = options;

  let untarjs: IUnpackJSAPI;
  if (options.untarjs) {
    untarjs = options.untarjs;
  } else {
    const untarjsReady = initUntarJS();
    untarjs = await untarjsReady;
  }

  const sharedLibsMap: TSharedLibsMap = {};

  if (empackEnvMeta.packages.length) {
    await Promise.all(
      empackEnvMeta.packages.map(async pkg => {
        const packageUrl = pkg?.url ?? `${pkgRootUrl}/${pkg.filename}`;
        if (verbose) {
          console.log(`Install ${pkg.filename} taken from ${packageUrl}`);
        }

        sharedLibsMap[pkg.name] = await installCondaPackage(
          empackEnvMeta.prefix,
          packageUrl,
          Module.FS,
          untarjs,
          !!verbose
        );
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
  await options.Module.init_phase_1(options.prefix, options.pythonVersion, options.verbose);
  options.Module.init_phase_2(options.prefix, options.pythonVersion, options.verbose);
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
  options: ILoadSharedLibsOptions,
): Promise<void[]> {
  const { sharedLibs, prefix, Module } = options;

  return Promise.all(
    sharedLibs.keys.map(async (pkg, i) => {
      const packageShareLibs = sharedLibs[pkg];

      if (packageShareLibs) {
        return await loadDynlibsFromPackage(
          prefix,
          pkg,
          packageShareLibs,
          Module
        );
      }
    })
  );
};

const waitRunDependencies = (Module: any): Promise<void> => {
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
};


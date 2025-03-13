import { initUntarJS, IUnpackJSAPI } from '@emscripten-forge/untarjs';
import {
  filterPackages,
  getSharedLibs,
  hasYml,
  IEmpackEnvMeta,
  IEmpackEnvMetaPkg,
  ILogger,
  ISolvedPackage,
  ISolvedPackages,
  ISolveOptions,
  saveFilesIntoEmscriptenFS,
  TSharedLibsMap,
  untarCondaPackage
} from './helper';
import { loadDynlibsFromPackage } from './dynload/dynload';
import { hasPipDependencies, solvePip } from './solverpip';
import { getSolvedPackages } from './solver';

export * from './helper';

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
   * Whether to install conda-meta for packages, default to False
   */
  generateCondaMeta?: boolean;

  /**
   * The untarjs API. If not provided, one will be initialized.
   */
  untarjs?: IUnpackJSAPI;

  /**
   * The logger to use during the bootstrap.
   */
  logger?: ILogger;
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
  const { empackEnvMeta, pkgRootUrl, Module, generateCondaMeta, logger } =
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
        logger?.log(`Installing ${pkg.filename}`);

        const extractedPackage = await untarCondaPackage({
          url,
          untarjs,
          verbose: false,
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

  /**
   * The logger to use.
   */
  logger?: ILogger;
}

export async function loadShareLibs(
  options: ILoadSharedLibsOptions
): Promise<void[]> {
  const { sharedLibs, prefix, Module, logger } = options;

  const sharedLibsLoad: Promise<void>[] = [];

  for (const pkgName of Object.keys(sharedLibs)) {
    const packageShareLibs = sharedLibs[pkgName];

    if (packageShareLibs.length > 0) {
      logger?.log(`Loading shared libraries from ${pkgName}`);
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
  options: ISolveOptions
): Promise<{ condaPackages: ISolvedPackages; pipPackages: ISolvedPackages }> {
  let { logger, ymlOrSpecs, pipSpecs, installedPackages } = options;
  let { installedPipPackages } = filterPackages(installedPackages);
  const isYml = hasYml(ymlOrSpecs);
  const condaPackages = (await getSolvedPackages(options)) as ISolvedPackages;

  let pipPackages: ISolvedPackages = {};

  logger?.log('Solved environment!');
  for (const solvedPackage of Object.values(condaPackages)) {
    logger?.log(
      solvedPackage.name,
      solvedPackage.version,
      solvedPackage.build_string
    );
  }

  if (isYml) {
    if (hasPipDependencies(ymlOrSpecs as string)) {
      if (!getPythonVersion(Object.values(condaPackages))) {
        const msg =
          'Cannot install pip dependencies without Python installed in the environment!';
        logger?.error(msg);
        throw msg;
      }
      logger?.log('');
      logger?.log('Process pip dependencies ...');
      pipPackages = await solvePip(
        ymlOrSpecs as string,
        condaPackages,
        [],
        logger
      );
    }
  } else if (pipSpecs) {
    if (!getPythonVersion(Object.values(condaPackages))) {
      const msg =
        'Cannot install pip dependencies without Python installed in the environment!';
      logger?.error(msg);
      throw msg;
    }
    logger?.log('');
    logger?.log('Process solving pip packages ...');
    Object.keys(installedPipPackages).map(filename => {
      let pipPackage = installedPipPackages?.[filename];
      let version = pipPackage.version ? `=${pipPackage.version}` : '';
      pipSpecs?.push(`${pipPackage.name}${version}`);
    });
    pipPackages = await solvePip('', condaPackages, pipSpecs, logger);
  }

  return {
    condaPackages,
    pipPackages
  };
}

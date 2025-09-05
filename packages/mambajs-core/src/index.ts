import {
  fetchByteArray,
  FilesData,
  initUntarJS,
  IUnpackJSAPI
} from '@emscripten-forge/untarjs';
import {
  getSharedLibs,
  removeFilesFromEmscriptenFS,
  saveFilesIntoEmscriptenFS,
  untarCondaPackage
} from './helper';
import {
  IBootstrapData,
  IEmpackEnvMeta,
  IEmpackEnvMetaMountPoint,
  IEmpackEnvMetaPkg,
  ILogger,
  ISolvedPackage,
  ISolvedPackages,
  ISolvedPipPackage,
  ISolvedPipPackages,
  TSharedLibsMap
} from './types';
import { loadDynlibsFromPackage } from './dynload/dynload';

export * from './types';
export * from './helper';
export * from './parser';

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
   * The Python version (will be inferred from the lock file if not provided)
   */
  pythonVersion?: number[];

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
export async function bootstrapEmpackPackedEnvironment(
  options: IBootstrapEmpackPackedEnvironmentOptions
): Promise<IBootstrapData> {
  const { empackEnvMeta } = options;

  if (empackEnvMeta.mounts) {
    await installMountPointToEmscriptenFS({
      mountPoints: empackEnvMeta.mounts,
      ...options
    });
  }

  empackEnvMeta.channels

  const solvedPkgs: ISolvedPackages = {};
  const solvedPipPkgs: ISolvedPipPackages = {};
  for (const empackPkg of empackEnvMeta.packages) {
    if (empackPkg.filename.endsWith('.whl')) {
      solvedPipPkgs[empackPkg.filename] = {
        name: empackPkg.name,
        version: empackPkg.version,
        url: empackPkg.url,
        registry: 'PyPi'
      };
    } else {
      // TODO !!!
      // solvedPkgs[empackPkg.filename] = {

      // };
    }
  }

  return await installPackagesToEmscriptenFS({
    ...options,
    packages: {
      packages: solvedPkgs,
      pipPackages: solvedPipPkgs,
    }
  });
}

export interface IInstallFilesToEnvOptions {
  /**
   * The URL (CDN or similar) from which to download packages
   */
  pkgRootUrl: string;

  /**
   * The Emscripten Module
   */
  Module: any;

  /**
   * The Python version (will be inferred from the lock file if not provided)
   */
  pythonVersion?: number[];

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

export interface IInstallPackagesToEnvOptions
  extends IInstallFilesToEnvOptions {
  /**
   * The packages to install
   */
  packages: {
    packages: ISolvedPackages,
    pipPackages: ISolvedPipPackages
  };
}

export interface IInstallMountPointsToEnvOptions
  extends IInstallFilesToEnvOptions {
  /**
   * The mount points to install
   */
  mountPoints: IEmpackEnvMetaMountPoint[];
}

/**
 * Install packages into an emscripten FS.
 *
 * @param options
 * @returns The installed shared libraries as a TSharedLibs
 */
export async function installPackagesToEmscriptenFS(
  options: IInstallPackagesToEnvOptions
): Promise<IBootstrapData> {
  const { packages, pkgRootUrl, Module, generateCondaMeta } = options;
  const condaPackages = packages.packages;
  const pipPackages = packages.pipPackages;

  let untarjs: IUnpackJSAPI;
  if (options.untarjs) {
    untarjs = options.untarjs;
  } else {
    const untarjsReady = initUntarJS();
    untarjs = await untarjsReady;
  }

  const sharedLibsMap: TSharedLibsMap = {};
  const pythonVersion = options.pythonVersion
    ? options.pythonVersion
    : getPythonVersion(Object.values(condaPackages));
  const paths = {};

  const processExtractedPackage = (pkg: ISolvedPackage | ISolvedPipPackage, filename: string, extractedPackage: FilesData) => {
    sharedLibsMap[pkg.name] = getSharedLibs(extractedPackage, '');
    paths[filename] = {};
    Object.keys(extractedPackage).forEach(filen => {
      paths[filename][filen] = `/${filen}`;
    });
    saveFilesIntoEmscriptenFS(Module.FS, extractedPackage, '');
  }

  await Promise.all(
    // Extract and install conda package
    Object.keys(condaPackages).map(async filename => {
      const pkg = condaPackages[filename];
      let extractedPackage: FilesData = {};

      const url = pkg?.url ? pkg.url : `${pkgRootUrl}/${filename}`;
      extractedPackage = await untarCondaPackage({
        url,
        untarjs,
        verbose: false,
        generateCondaMeta,
        pythonVersion
      });

      processExtractedPackage(pkg, filename, extractedPackage);
    })
    // Extract and install pip wheels
    .concat(Object.keys(pipPackages).map(async filename => {
      const pkg = pipPackages[filename];
      let extractedPackage: FilesData = {};

      // Special case for wheels
      if (!pythonVersion) {
        const msg = 'Cannot install wheel if Python is not there';
        console.error(msg);
        throw msg;
      }

      // TODO Read record properly to know where to put each files
      const rawData = await fetchByteArray(pkg.url);
      const rawPackageData = await untarjs.extractData(rawData, false);
      for (const key of Object.keys(rawPackageData)) {
        extractedPackage[
          `lib/python${pythonVersion[0]}.${pythonVersion[1]}/site-packages/${key}`
        ] = rawPackageData[key];
      }

      processExtractedPackage(pkg, filename, extractedPackage);
    }))
  );
  await waitRunDependencies(Module);

  return { sharedLibs: sharedLibsMap, paths: paths, untarjs };
}

export async function installMountPointToEmscriptenFS(
  options: IInstallMountPointsToEnvOptions
): Promise<void> {
  const { mountPoints, pkgRootUrl, Module, logger } = options;

  let untarjs: IUnpackJSAPI;
  if (options.untarjs) {
    untarjs = options.untarjs;
  } else {
    const untarjsReady = initUntarJS();
    untarjs = await untarjsReady;
  }

  await Promise.all(
    mountPoints.map(async mountPoint => {
      const url = `${pkgRootUrl}/${mountPoint.filename}`;
      logger?.log(`Extracting ${mountPoint.filename}`);
      const extractedMountPoint = await untarjs.extract(url);

      saveFilesIntoEmscriptenFS(Module.FS, extractedMountPoint, '');
    })
  );
}

export interface IRemovePackagesFromEnvOptions {
  /**
   * The packages which should be removed
   */
  removedPackages: ISolvedPackages;

  /**
   * The Emscripten Module
   */
  Module: any;

  /**
   * Paths where previous installed package files have been saved
   */

  paths: { [key: string]: string };

  /**
   * The logger to use during the bootstrap.
   */
  logger?: ILogger;
}

/**
 * Removing previously installed files
 *
 * @param options
 * @returns void
 */
export const removePackagesFromEmscriptenFS = async (
  options: IRemovePackagesFromEnvOptions
): Promise<{ [key: string]: string }> => {
  const { removedPackages, Module, paths } = options;
  const newPath = { ...paths };

  const removedPackagesMap: { [name: string]: string } = {};
  Object.keys(removedPackages).forEach(filename => {
    const removedPkg = removedPackages[filename];
    const pkg = `${removedPkg.name}-${removedPkg.version}-${removedPkg.build_string}`;
    removedPackagesMap[filename] = pkg;
  });

  Object.keys(removedPackages).map(filename => {
    let packages = newPath[filename];
    if (!packages) {
      // file extensions can be different after resolving packages even though a package has the same name, build and version,
      // so we need to check this and delete
      const pkgData = removedPackagesMap[filename];
      Object.keys(newPath).forEach((path: string) => {
        if (path.includes(pkgData)) {
          packages = newPath[path];
        }
      });
    }
    if (!packages) {
      throw new Error(`There are no paths for ${filename}`);
    }
    removeFilesFromEmscriptenFS(Module.FS, Object.values(packages));
    delete newPath[filename];
  });
  return newPath;
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

/**
 * @deprecated Use loadSharedLibs instead
 */
export const loadShareLibs = loadSharedLibs;

export async function loadSharedLibs(
  options: ILoadSharedLibsOptions
): Promise<void[]> {
  const { sharedLibs, prefix, Module } = options;

  const sharedLibsLoad: Promise<void>[] = [];

  for (const pkgName of Object.keys(sharedLibs)) {
    const packageShareLibs = sharedLibs[pkgName];

    if (packageShareLibs.length > 0) {
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

export function showPipPackagesList(
  installedPackages: ISolvedPackages,
  logger: ILogger | undefined
) {
  if (Object.keys(installedPackages).length) {
    const sortedPackages = sort(installedPackages);

    const columnWidth = 30;

    logger?.log(
      `${'Name'.padEnd(columnWidth)}${'Version'.padEnd(columnWidth)}`
    );

    logger?.log('─'.repeat(2 * columnWidth));

    for (const [, pkg] of sortedPackages) {
      if (pkg.repo_name !== 'PyPi') {
        continue;
      }

      logger?.log(
        `${pkg.name.padEnd(columnWidth)}${pkg.version.padEnd(columnWidth)}`
      );
    }
  }
}

export function showPackagesList(
  installedPackages: ISolvedPackages,
  logger: ILogger | undefined
) {
  if (Object.keys(installedPackages).length) {
    const sortedPackages = sort(installedPackages);

    const columnWidth = 30;

    logger?.log(
      `${'Name'.padEnd(columnWidth)}${'Version'.padEnd(columnWidth)}${'Build'.padEnd(columnWidth)}${'Channel'.padEnd(columnWidth)}`
    );

    logger?.log('─'.repeat(4 * columnWidth));

    for (const [, pkg] of sortedPackages) {
      const buildString = pkg.build_string || 'unknown';
      const repoName = pkg.repo_name ? pkg.repo_name : '';

      logger?.log(
        `${pkg.name.padEnd(columnWidth)}${pkg.version.padEnd(columnWidth)}${buildString.padEnd(columnWidth)}${repoName.padEnd(columnWidth)}`
      );
    }
  }
}

export function showEnvironmentDiff(
  installedPackages: ISolvedPackages,
  newPackages: ISolvedPackages,
  logger: ILogger | undefined
) {
  if (Object.keys(newPackages).length) {
    const previousInstall = new Map<string, ISolvedPackage>();
    for (const name of Object.keys(installedPackages)) {
      previousInstall.set(
        installedPackages[name].name,
        installedPackages[name]
      );
    }
    const newInstall = new Map<string, ISolvedPackage>();
    for (const name of Object.keys(newPackages)) {
      newInstall.set(newPackages[name].name, newPackages[name]);
    }

    const sortedPackages = sort(newPackages);

    const columnWidth = 30;

    let loggedHeader = false;

    const logHeader = () => {
      logger?.log(
        `  ${'Name'.padEnd(columnWidth)}${'Version'.padEnd(columnWidth)}${'Build'.padEnd(columnWidth)}${'Channel'.padEnd(columnWidth)}`
      );

      logger?.log('─'.repeat(4 * columnWidth));
    };

    for (const [, pkg] of sortedPackages) {
      const prevPkg = previousInstall.get(pkg.name);

      // Not listing untouched packages
      if (
        prevPkg &&
        prevPkg.version === pkg.version &&
        prevPkg.build_string === pkg.build_string
      ) {
        continue;
      }

      if (!loggedHeader) {
        logHeader();

        loggedHeader = true;
      }

      let prefix = '';
      let versionDiff: string;
      let buildStringDiff: string;
      let channelDiff: string;

      if (!prevPkg) {
        prefix = '\x1b[0;32m+';
        versionDiff = pkg.version;
        buildStringDiff = pkg.build_string || '';
        channelDiff = pkg.repo_name || '';
      } else {
        prefix = '\x1b[38;5;208m~';
        versionDiff = `${prevPkg.version} -> ${pkg.version}`;
        buildStringDiff = `${prevPkg.build_string || 'unknown'} -> ${pkg.build_string || 'unknown'}`;
        channelDiff =
          prevPkg.repo_name === pkg.repo_name
            ? pkg.repo_name || ''
            : `${prevPkg.repo_name} -> ${pkg.repo_name}`;
      }

      logger?.log(
        `${prefix} ${pkg.name.padEnd(columnWidth)}\x1b[0m${versionDiff.padEnd(columnWidth)}${buildStringDiff.padEnd(columnWidth)}${channelDiff.padEnd(columnWidth)}`
      );
    }

    // Displaying removed packages
    for (const [name, pkg] of previousInstall) {
      if (pkg.repo_name !== 'PyPi' && !newInstall.has(name)) {
        if (!loggedHeader) {
          logHeader();

          loggedHeader = true;
        }

        logger?.log(
          `\x1b[0;31m- ${pkg.name.padEnd(columnWidth)}\x1b[0m${pkg.version.padEnd(columnWidth)}${pkg.build_string?.padEnd(columnWidth)}${pkg.repo_name?.padEnd(columnWidth)}`
        );
      }
    }

    if (!loggedHeader) {
      logger?.log('All requested packages already installed.');
    }
  }
}

export function sort(installed: ISolvedPackages): Map<string, ISolvedPackage> {
  const sorted = Object.entries(installed).sort((a, b) => {
    const packageA: any = a[1];
    const packageB: any = b[1];
    return packageA.name.localeCompare(packageB.name);
  });

  return new Map(sorted);
}

export function packageNameFromSpec(specs: string) {
  const nameMatch = specs.match(/^([a-zA-Z0-9_-]+)/);

  if (!nameMatch) {
    return null;
  }

  const packageName = nameMatch[1];
  return packageName;
}

import {
  fetchByteArray,
  FilesData,
  initUntarJS,
  IUnpackJSAPI
} from '@emscripten-forge/untarjs';
import {
  computePackageUrl,
  formatChannels,
  getSharedLibs,
  removeFilesFromEmscriptenFS,
  saveFilesIntoEmscriptenFS,
  untarCondaPackage
} from './helper';
import {
  DEFAULT_PLATFORM,
  IBootstrapData,
  IEmpackEnvMeta,
  IEmpackEnvMetaMountPoint,
  IEmpackEnvMetaPkg,
  IInstalledData,
  ILock,
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

  const formattedChannels = formatChannels(empackEnvMeta.channels);

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
      solvedPkgs[empackPkg.filename] = {
        name: empackPkg.name,
        version: empackPkg.version,
        channel: empackPkg.channel ? empackPkg.channel : '',
        build: empackPkg.build,
        subdir: empackPkg.subdir ? empackPkg.subdir : ''
      };
    }
  }

  const installed = await installPackagesToEmscriptenFS({
    ...options,
    channels: formattedChannels.channelInfo,
    packages: {
      packages: solvedPkgs,
      pipPackages: solvedPipPkgs
    }
  });

  return {
    ...installed,
    lock: {
      lockVersion: '1.0.0',
      specs: empackEnvMeta.specs ?? [],
      platform: DEFAULT_PLATFORM,
      channels: formattedChannels.channels,
      channelInfo: formattedChannels.channelInfo,
      packages: solvedPkgs,
      pipPackages: solvedPipPkgs
    }
  };
}

export interface IInstallFilesToEnvOptions {
  /**
   * The URL (CDN or similar) from which to download packages
   */
  pkgRootUrl?: string;

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
   * The lock file containing packages to install
   */
  packages: {
    packages: ISolvedPackages;
    pipPackages: ISolvedPipPackages;
  };

  /**
   * The channel from where to install the package
   */
  channels: ILock['channelInfo'];
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
): Promise<IInstalledData> {
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

  const processExtractedPackage = (
    pkg: ISolvedPackage | ISolvedPipPackage,
    filename: string,
    extractedPackage: FilesData
  ) => {
    sharedLibsMap[pkg.name] = getSharedLibs(extractedPackage, '');
    paths[filename] = {};
    Object.keys(extractedPackage).forEach(filen => {
      paths[filename][filen] = `/${filen}`;
    });
    saveFilesIntoEmscriptenFS(Module.FS, extractedPackage, '');
  };

  await Promise.all(
    // Extract and install conda package
    Object.keys(condaPackages)
      .map(async filename => {
        const pkg = condaPackages[filename];
        let extractedPackage: FilesData = {};

        const url = pkgRootUrl
          ? `${pkgRootUrl}/${filename}`
          : computePackageUrl(pkg, filename, options.channels);
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
      .concat(
        Object.keys(pipPackages).map(async filename => {
          const pkg = pipPackages[filename];
          const extractedPackage: FilesData = {};

          // Special case for wheels
          if (!pythonVersion) {
            const msg = 'Cannot install wheel if Python is not there';
            console.error(msg);
            throw msg;
          }

          // TODO Read record properly to know where to put each files
          const rawData = await fetchByteArray(
            pkgRootUrl ? `${pkgRootUrl}/${filename}` : pkg.url
          );
          const rawPackageData = await untarjs.extractData(rawData, false);
          for (const key of Object.keys(rawPackageData)) {
            extractedPackage[
              `lib/python${pythonVersion[0]}.${pythonVersion[1]}/site-packages/${key}`
            ] = rawPackageData[key];
          }

          processExtractedPackage(pkg, filename, extractedPackage);
        })
      )
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
  removedPackages: {
    packages: ISolvedPackages;
    pipPackages: ISolvedPipPackages;
  };

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
export async function removePackagesFromEmscriptenFS(
  options: IRemovePackagesFromEnvOptions
): Promise<{ [key: string]: string }> {
  const { Module, paths } = options;
  const removedPackages = {
    ...options.removedPackages.packages,
    ...options.removedPackages.pipPackages
  };
  const newPath = { ...paths };

  const removedPackagesMap: { [name: string]: string } = {};
  Object.keys(removedPackages).forEach(filename => {
    const removedPkg = removedPackages[filename];
    const pkg = `${removedPkg.name}-${removedPkg.version}-${removedPkg['build'] ? removedPkg['build'] : removedPkg['registry']}`;
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
}

export interface IUpdatePackagesOptions extends IInstallPackagesToEnvOptions {
  /**
   * The old lock
   */
  oldLock: ILock;

  /**
   * The new lock
   */
  newLock: ILock;

  /**
   * The Emscripten Module
   */
  Module: any;

  /**
   * Paths where previous installed package files have been saved
   */
  paths: { [key: string]: string };
}

/**
 * Update packages in an Emscripten FS, given the old and new locks
 *
 * @param options
 * @returns void
 */
export async function updatePackagesInEmscriptenFS(
  options: IUpdatePackagesOptions
): Promise<{ path: { [key: string]: string }; sharedLibs: TSharedLibsMap }> {
  const {
    newLock,
    oldLock,
    Module,
    logger,
    untarjs,
    pythonVersion,
    pkgRootUrl,
    channels
  } = options;
  const oldPaths = options.paths;

  const pipPackageDiff = computePipPackagesDiff({ oldLock, newLock });
  const condaPackageDiff = computeCondaPackagesDiff({ oldLock, newLock });

  const newPath = await removePackagesFromEmscriptenFS({
    removedPackages: {
      pipPackages: pipPackageDiff.removedPackages,
      packages: condaPackageDiff.removedPackages
    },
    Module,
    paths: oldPaths,
    logger
  });

  const { sharedLibs, paths } = await installPackagesToEmscriptenFS({
    packages: {
      pipPackages: pipPackageDiff.newPackages,
      packages: condaPackageDiff.newPackages
    },
    channels,
    pkgRootUrl,
    pythonVersion,
    Module,
    untarjs,
    logger
  });

  return { path: { ...newPath, ...paths }, sharedLibs };
}

export function computePipPackagesDiff(options: {
  oldLock: ILock;
  newLock: ILock;
}): { removedPackages: ISolvedPipPackages; newPackages: ISolvedPipPackages } {
  const { oldLock, newLock } = options;

  const removedPackages: ISolvedPipPackages = {};
  const newPackages: ISolvedPipPackages = {};

  // First create structures we can quickly inspect
  const newInstalledPackagesMap: ISolvedPipPackages = {};
  for (const newInstalledPkg of Object.values(newLock.pipPackages)) {
    newInstalledPackagesMap[newInstalledPkg.name] = newInstalledPkg;
  }
  const oldInstalledPackagesMap: ISolvedPipPackages = {};
  for (const oldInstalledPkg of Object.values(oldLock.pipPackages)) {
    oldInstalledPackagesMap[oldInstalledPkg.name] = oldInstalledPkg;
  }

  // Compare old installed packages with new ones
  for (const filename of Object.keys(oldLock.pipPackages)) {
    const installedPkg = oldLock.pipPackages[filename];

    // Exact same build of the package already installed
    if (
      installedPkg.name in newInstalledPackagesMap &&
      installedPkg.version ===
        newInstalledPackagesMap[installedPkg.name].version
    ) {
      continue;
    }

    removedPackages[filename] = installedPkg;
  }

  // Compare new installed packages with old ones
  for (const filename of Object.keys(newLock.pipPackages)) {
    const newPkg = newLock.pipPackages[filename];

    // Exact same build of the package already installed
    if (
      newPkg.name in oldInstalledPackagesMap &&
      newPkg.version === oldInstalledPackagesMap[newPkg.name].version
    ) {
      continue;
    }

    newPackages[filename] = newPkg;
  }

  return {
    removedPackages,
    newPackages
  };
}

export function computeCondaPackagesDiff(options: {
  oldLock: ILock;
  newLock: ILock;
}): { removedPackages: ISolvedPackages; newPackages: ISolvedPackages } {
  const { oldLock, newLock } = options;

  const removedPackages: ISolvedPackages = {};
  const newPackages: ISolvedPackages = {};

  // First create structures we can quickly inspect
  const newInstalledPackagesMap: ISolvedPackages = {};
  for (const newInstalledPkg of Object.values(newLock.packages)) {
    newInstalledPackagesMap[newInstalledPkg.name] = newInstalledPkg;
  }
  const oldInstalledPackagesMap: ISolvedPackages = {};
  for (const oldInstalledPkg of Object.values(oldLock.packages)) {
    oldInstalledPackagesMap[oldInstalledPkg.name] = oldInstalledPkg;
  }

  // Compare old installed packages with new ones
  for (const filename of Object.keys(oldLock.packages)) {
    const installedPkg = oldLock.packages[filename];

    // Exact same build of the package already installed
    if (
      installedPkg.name in newInstalledPackagesMap &&
      installedPkg.build === newInstalledPackagesMap[installedPkg.name].build &&
      installedPkg.version ===
        newInstalledPackagesMap[installedPkg.name].version
    ) {
      continue;
    }

    removedPackages[filename] = installedPkg;
  }

  // Compare new installed packages with old ones
  for (const filename of Object.keys(newLock.packages)) {
    const newPkg = newLock.packages[filename];

    // Exact same build of the package already installed
    if (
      newPkg.name in oldInstalledPackagesMap &&
      newPkg.build === oldInstalledPackagesMap[newPkg.name].build &&
      newPkg.version === oldInstalledPackagesMap[newPkg.name].version
    ) {
      continue;
    }

    newPackages[filename] = newPkg;
  }

  return {
    removedPackages,
    newPackages
  };
}

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
  installedPackages: ISolvedPipPackages,
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
      logger?.log(
        `${pkg.name.padEnd(columnWidth)}${pkg.version.padEnd(columnWidth)}`
      );
    }
  }
}

export function showPackagesList(
  installedPackages: {
    packages: ISolvedPackages;
    pipPackages: ISolvedPipPackages;
  },
  logger: ILogger | undefined
) {
  const merged = {
    ...installedPackages.packages,
    ...installedPackages.pipPackages
  };

  if (Object.keys(merged).length) {
    const sortedPackages = sort(merged);

    const columnWidth = 30;

    logger?.log(
      `${'Name'.padEnd(columnWidth)}${'Version'.padEnd(columnWidth)}${'Build'.padEnd(columnWidth)}${'Channel'.padEnd(columnWidth)}`
    );

    logger?.log('─'.repeat(4 * columnWidth));

    for (const [, pkg] of sortedPackages) {
      const buildString = pkg['build'] || 'unknown';
      const repoName = pkg['channel']
        ? pkg['channel']
        : pkg['registry']
          ? pkg['registry']
          : '';

      logger?.log(
        `${pkg.name.padEnd(columnWidth)}${pkg.version.padEnd(columnWidth)}${buildString.padEnd(columnWidth)}${repoName.padEnd(columnWidth)}`
      );
    }
  }
}

export function showEnvironmentDiff(
  installedPackages: {
    packages: ISolvedPackages;
    pipPackages: ISolvedPipPackages;
  },
  newPackages: {
    packages: ISolvedPackages;
    pipPackages: ISolvedPipPackages;
  },
  logger: ILogger | undefined
) {
  const mergedNewPackages = {
    ...newPackages.packages,
    ...newPackages.pipPackages
  };
  const mergedInstalledPackages = {
    ...installedPackages.packages,
    ...installedPackages.pipPackages
  };

  if (Object.keys(mergedNewPackages).length) {
    const previousInstall = new Map<
      string,
      ISolvedPackage | ISolvedPipPackage
    >();
    for (const name of Object.keys(mergedInstalledPackages)) {
      previousInstall.set(
        mergedInstalledPackages[name].name,
        mergedInstalledPackages[name]
      );
    }
    const newInstall = new Map<string, ISolvedPackage | ISolvedPipPackage>();
    for (const name of Object.keys(mergedNewPackages)) {
      newInstall.set(mergedNewPackages[name].name, mergedNewPackages[name]);
    }

    const sortedPackages = sort(mergedNewPackages);

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
        prevPkg['build'] === pkg['build']
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
        buildStringDiff = pkg['build'] || 'unknown';
        channelDiff = pkg['channel'] || pkg['registry'] || '';
      } else {
        const oldChannel = prevPkg['channel'] || prevPkg['registry'] || '';
        const newChannel = prevPkg['channel'] || prevPkg['registry'] || '';

        prefix = '\x1b[38;5;208m~';
        versionDiff = `${prevPkg.version} -> ${pkg.version}`;
        buildStringDiff = `${prevPkg['build'] || 'unknown'} -> ${pkg['build'] || 'unknown'}`;
        channelDiff =
          oldChannel === newChannel
            ? oldChannel || ''
            : `${oldChannel} -> ${newChannel}`;
      }

      logger?.log(
        `${prefix} ${pkg.name.padEnd(columnWidth)}\x1b[0m${versionDiff.padEnd(columnWidth)}${buildStringDiff.padEnd(columnWidth)}${channelDiff.padEnd(columnWidth)}`
      );
    }

    // Displaying removed packages
    for (const [name, pkg] of previousInstall) {
      if (!newInstall.has(name)) {
        if (!loggedHeader) {
          logHeader();

          loggedHeader = true;
        }

        logger?.log(
          `\x1b[0;31m- ${pkg.name.padEnd(columnWidth)}\x1b[0m${pkg.version.padEnd(columnWidth)}${(pkg['build'] || 'unknown')?.padEnd(columnWidth)}${(pkg['channel'] || pkg['registry'])?.padEnd(columnWidth)}`
        );
      }
    }

    if (!loggedHeader) {
      logger?.log('All requested packages already installed.');
    }
  }
}

export function sort(installed: {
  [key: string]: ISolvedPackage | ISolvedPipPackage;
}): Map<string, ISolvedPackage | ISolvedPipPackage> {
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

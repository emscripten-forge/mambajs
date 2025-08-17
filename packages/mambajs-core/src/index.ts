import {
  fetchByteArray,
  FilesData,
  initUntarJS,
  IUnpackJSAPI
} from '@emscripten-forge/untarjs';
import {
  getSharedLibs,
  IBootstrapData,
  IEmpackEnvMeta,
  IEmpackEnvMetaMountPoint,
  IEmpackEnvMetaPkg,
  ILogger,
  ISolvedPackage,
  ISolvedPackages,
  removeFilesFromEmscriptenFS,
  saveFilesIntoEmscriptenFS,
  TSharedLibs,
  TSharedLibsMap,
  untarCondaPackage,
  checkWasmMagicNumber
} from './helper';
import { loadDynlibsFromPackage } from './dynload/dynload';

export * from './helper';
export * from './parser';

class FetchFile {
  constructor({ url }: { url: string | URL }) {
    this.url_ = url;
    // start it
  }

  async init() {
    const response = await fetch(this.url_);
    if (!response.ok) {
      throw new Error(
        'Error fetching ' + this.url_ + ' :' + response.statusText
      );
    }
    const filesize = response.headers.get('Content-Length');
    if (filesize) this.filesize_ = Number(filesize);
    // only temporarily, we want streaming and chunking!
    this.data_ = response.bytes();
    // this.data_.then((data) => console.log('Show downloaded data', data));
  }

  getProps(Module: any) {
    if (typeof this.filesize_ === 'undefined')
      throw new Error('getProps on uninitialized object');

    const props = {
      size: this.filesize_,
      callback: async (offset: bigint, buffer: number, size: number) => {
        const dest = new Uint8Array(Module.HEAPU8.buffer, buffer, size);
        if (this.data_ instanceof Promise) {
          this.data_ = await this.data_;
        }
        if (!this.data_) return -2; // SQFS IO ERROR
        const src = new Uint8Array(
          this.data_.buffer,
          this.data_?.byteOffset + Number(offset),
          size
        );
        // now we copy
        dest.set(src);
        return 0; // success
      }
    };
    return props;
  }

  // return Emval.toHandle(props);

  private url_: string | URL;
  private filesize_: undefined | number;
  private data_: Promise<Uint8Array> | Uint8Array | undefined;
}

// name of a full environment
const envSqshfs = 'environment.sqshfs';
const squashfsFS = []; // I do not like global objects....

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

  const solvedPkgs: ISolvedPackages = {};
  for (const empackPkg of empackEnvMeta.packages) {
    if (empackPkg.filename !== envSqshfs) {
      solvedPkgs[empackPkg.filename] = empackPkg;
    } else {
      solvedPkgs[envSqshfs] = {
        url: empackPkg.url,
        name: 'conda_environment',
        version: '0.0.0'
      };
    }
  }

  return await installPackagesToEmscriptenFS({
    packages: solvedPkgs,
    ...options
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
  packages: ISolvedPackages;
}

export interface IInstallMountPointsToEnvOptions
  extends IInstallFilesToEnvOptions {
  /**
   * The mount points to install
   */
  mountPoints: IEmpackEnvMetaMountPoint[];
}

interface FileObject {
  isFolder: boolean;
  isFile: boolean;
  isLink: boolean;
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
    : getPythonVersion(Object.values(packages));
  const paths = {};
  let squashFSinflight: Promise<void> | undefined;
  let squashFSinflightRes: (
    value: void | PromiseLike<void>
  ) => void | undefined;

  await Promise.all(
    Object.keys(packages).map(async filename => {
      const pkg = packages[filename];
      let extractedPackage: FilesData = {};

      const sharedLibs: TSharedLibs = (sharedLibsMap[pkg.name] = []);

      if (filename.endsWith('sqshfs')) {
        // special case for squashfs
        // concurrent execution is not allowed, due to asyncify's limitations
        while (squashFSinflight) {
          // This simulates a mutex
          await squashFSinflight;
        }
        squashFSinflight = new Promise(
          resolve => (squashFSinflightRes = resolve)
        );
        const url = pkg?.url ? pkg.url : `${pkgRootUrl}/${filename}`;
        console.log('squashfs url', url);
        // we need to mount the pkgRoot or other baseURL as single Filesystem
        let sFS = squashfsFS[url];
        if (!sFS) {
          try {
            // in case it is the first, we need to create the mount point's parent
            if (Object.entries(squashfsFS).length === 0) {
              await Module.mkdirAsync('/squashfs', 0o777);
              console.log(
                'Diagnosis mkdirAsync',
                await Module.readDirAsync('/')
              );
            }
            const ff = (squashfsFS[url] = new FetchFile({ url }));
            await ff.init(); // do the initial downloads
            const props = ff.getProps(Module);

            const success =
              await Module.wasmfs_create_squashfs_backend_callback_and_mount(
                props,
                '/squashfs/' + filename
              );
            if (!success) {
              throw new Error('Mounting of directory failed for ' + filename);
            }
          } catch (error) {
            console.log(
              'Problem downloading sqfs of file:',
              url,
              'with error:',
              error
            );
          }

          // then we need to symlink the package content into the normal fs
          const startDirSrc = '/squashfs/' + filename;
          const startDirDest = ''; // equals to '/'
          console.log('Diagnosis readir', await Module.readDirAsync('/'));
          console.log(
            'Diagnosis readir2',
            await Module.readDirAsync('/squashfs')
          );
          console.log(
            'Diagnosis readir3',
            await Module.readDirAsync('/squashfs/')
          );
          console.log(
            'Diagnosis readir4',
            await Module.readDirAsync(startDirSrc)
          );
          paths[filename] = {};
          const pathTest = ['/lib/python3.13/site-packages/']; // can this be determined programmatically?
          const doSymLink = async (
            dirSrc: string,
            dirDest: string,
            symlink: boolean
          ) => {
            const entries = await Module.readDirAsync(dirSrc);
            for (const entry of entries) {
              if (entry === '.' || entry === '..') continue;
              const srcPath = dirSrc + '/' + entry;
              const destPath = dirDest + '/' + entry;
              const srcObj = (await Module.findObjectAsync(
                srcPath
              )) as FileObject;
              const destObj = (await Module.findObjectAsync(
                destPath
              )) as FileObject;
              if (
                !srcObj.isFolder &&
                (srcPath.endsWith('.so') || srcPath.includes('.so.'))
              ) {
                // should we really link them all beforehand or on demand?
                const buffer = await Module.readFileSignAsync(srcPath);
                if (checkWasmMagicNumber(buffer)) {
                  sharedLibs.push(destPath);
                }
              }
              if (!destObj) {
                if (srcObj.isFolder) {
                  // now we need to find out, if we should symlink and exit
                  let directSymlink = false;
                  if (
                    pathTest.some(fragment => {
                      const indexfrg = srcPath.indexOf(fragment);
                      if (
                        indexfrg !== -1 &&
                        srcPath.length > indexfrg + fragment.length
                      )
                        return true;
                      return false;
                    })
                  )
                    directSymlink = true;
                  if (directSymlink) {
                    // direct Symlink is ok
                    if (symlink) {
                      await Module.symlinkAsync(srcPath, destPath);
                      paths[filename][destPath.slice(1)] = destPath;
                    }
                    await doSymLink(srcPath, destPath, false); // we need to continue to look for libs
                  } else {
                    // in this case we need to create a dir
                    if (symlink) await Module.mkdirAsync(destPath, 0o777);
                    // and do a another round
                    await doSymLink(srcPath, destPath, symlink);
                  }
                } else {
                  // it is a file! We symlink and are done
                  if (symlink) {
                    await Module.symlinkAsync(srcPath, destPath);
                    paths[filename][destPath.slice(1)] = destPath;
                  }
                }
              } else {
                // destObj exists!
                if (destObj.isFolder) {
                  if (!srcObj.isFolder)
                    throw new Error('Dest/Src type mismatch DF');
                  // Call me again
                  await doSymLink(srcPath, destPath, symlink);
                } else {
                  // ups a destination file exists, we throw, or should we delete?
                  if (symlink) throw new Error('Destination file exists: ' + destPath);
                }
              }
            }
          };
          await doSymLink(startDirSrc, startDirDest, true);
          squashFSinflight = undefined;
          squashFSinflightRes();
        }
      } else {
        // Special case for wheels
        if (pkg.url?.endsWith('.whl')) {
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
        } else {
          const url = pkg?.url ? pkg.url : `${pkgRootUrl}/${filename}`;
          extractedPackage = await untarCondaPackage({
            url,
            untarjs,
            verbose: false,
            generateCondaMeta,
            pythonVersion
          });
        }
        // TODO for sqshfs
        sharedLibsMap[pkg.name] = getSharedLibs(extractedPackage, '');
        paths[filename] = {};
        Object.keys(extractedPackage).forEach(filen => {
          paths[filename][filen] = `/${filen}`;
        });
        saveFilesIntoEmscriptenFS(Module.FS, extractedPackage, '');
      }
    })
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

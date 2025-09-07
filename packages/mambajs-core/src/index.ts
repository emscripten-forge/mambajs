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
import { SharedMem, SharedMemMain, SharedMemFile } from './squashfshelper';
//@ts-ignore
import Worker from './sqfs.worker.ts';
import { PromiseDelegate } from '@lumino/coreutils';

export * from './helper';
export * from './parser';

class SquashFSFetching {
  constructor(Module: any) {
    this.Module_ = Module;
    this.sharedMem_ = new SharedMem(Module.HEAPU8.buffer);
    const sharedMemMainPtr = Module._malloc(5);
    this.sharedMemMain_ = new SharedMemMain(this.sharedMem_, sharedMemMainPtr);
    this.sharedMemMain_.nextFileIdToGet = 0;
    this.sharedMemMain_.crossOriginIsolated = crossOriginIsolated;
    console.log('DEBUG crossOriginIsolated', crossOriginIsolated);
    if (crossOriginIsolated) {
      this.worker_ = Worker();
      this.sendWorkerMessage({
        task: 'init',
        heap: Module.HEAPU8.buffer,
        sharedMemMain: this.sharedMemMain_.ptr
      });

      this.worker_.onmessage = ({ data }) => {
        console.log('Message from worker');
        if (data.started) {
          console.log('Worker started');
          this.worker_.postMessage({ task: 'ping' });
          const pendMessages = this.workerPendingMessages_;
          this.workerPendingMessages_ = undefined;
          pendMessages?.forEach?.(value => {
            console.log('send pending mess', value);
            this.worker_.postMessage(value);
          });
        } else if (data.inited) {
          this.inited_.resolve(undefined);
        } else if (data.messageid) {
          this.messProms_[data.messageid].resolve(undefined);
        }
      };
    }
  }

  sendWorkerMessage(message: { [key: string]: any }) {
    message.messid_ = this.messId;
    const delegate = (this.messProms_[this.messId] = new PromiseDelegate());
    this.messId++;
    if (this.workerPendingMessages_ !== undefined) {
      this.workerPendingMessages_.push(message);
    } else {
      this.worker_.postMessage(message);
    }
    return delegate.promise;
  }

  async openSquashfsFile(url: string | URL) {
    const sharedMemFilePtr = this.Module_._malloc(SharedMemFile.memSize);
    const memArray = new Uint8Array(
      this.Module_.HEAPU8.buffer,
      sharedMemFilePtr,
      SharedMemFile.memSize
    );
    memArray.fill(0); // set to all zeros
    const sharedMemFile = new SharedMemFile(this.sharedMem_, sharedMemFilePtr);
    sharedMemFile.fileId = this.curId_++;
    sharedMemFile.mainStruct = this.sharedMemMain_;

    if (this.worker_) {
      await this.sendWorkerMessage({
        task: 'addFile',
        sharedMemFile: sharedMemFile.ptr,
        url
      });
    } else {
      // note we need a fallback in case we are not on a shared worker
      // I think then we should use synchronous callback and fetch it before hand
    }

    return sharedMemFile;
  }

  get inited() {
    return this.inited_.promise;
  }

  // TODO add methods to close file, otherwise this is a big memory leak...

  private curId_: number = 1;
  private Module_: any;
  private sharedMem_: SharedMem;
  private sharedMemMain_: SharedMemMain;
  private worker_: Worker | undefined;
  private workerPendingMessages_: object[] | undefined = [];
  private inited_ = new PromiseDelegate();
  private messProms_: { [key: string]: PromiseDelegate<undefined> } = {};
  private messId = 1;
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
  const FS = Module.FS;

  if (!Module.squashfsFetch) {
    // I do not like, this, what would be a canoical way
    // to have it only only per Instance and more important, how to shut down the worker
    // or should we share the worker?
    Module.squashfsFetch = new SquashFSFetching(Module);
  }
  const promDel = new PromiseDelegate();
  setTimeout(() => promDel.resolve(undefined), 1000);
  await promDel.promise;
  const squashfsFetch = Module.squashfsFetch as SquashFSFetching;

  await Promise.all(
    Object.keys(packages).map(async filename => {
      const pkg = packages[filename];
      let extractedPackage: FilesData = {};

      const sharedLibs: TSharedLibs = (sharedLibsMap[pkg.name] = []);

      if (filename.endsWith('sqshfs')) {
        await Module.squashfsFetch.inited;
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
          squashfsFS[url] = true;
          try {
            // in case it is the first, we need to create the mount point's parent
            if (Object.entries(squashfsFS).length === 0) {
              FS.mkdir('/squashfs', 0o777);
            }
            const sqfsFile = await squashfsFetch.openSquashfsFile(url);
            const success = FS.mount(
              {
                createBackend: () => {
                  return Module._wasmfs_create_squashfs_backend_memfile(
                    sqfsFile.ptr // FIXME should be pointer of a file object
                  );
                }
              },
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
          console.log('Diagnosis readir', FS.readDir('/'));
          console.log('Diagnosis readir2', FS.readDir('/squashfs'));
          console.log('Diagnosis readir3', FS.readDir('/squashfs/'));
          console.log('Diagnosis readir4', FS.readDir(startDirSrc));
          paths[filename] = {};
          const pathTest = ['/lib/python3.13/site-packages/']; // can this be determined programmatically?
          const doSymLink = (
            dirSrc: string,
            dirDest: string,
            symlink: boolean
          ) => {
            const entries = FS.readDir(dirSrc);
            for (const entry of entries) {
              if (entry === '.' || entry === '..') continue;
              const srcPath = dirSrc + '/' + entry;
              const destPath = dirDest + '/' + entry;
              const srcObj = FS.findObject(srcPath) as FileObject;
              const destObj = FS.findObject(destPath) as FileObject;
              if (
                !srcObj.isFolder &&
                (srcPath.endsWith('.so') || srcPath.includes('.so.'))
              ) {
                // should we really link them all beforehand or on demand?
                const file = FS.open(srcPath, 'r');
                const buffer = new Uint8Array(4);
                FS.read(file, buffer, 0, 4, 0);
                FS.close(file);
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
                      FS.symlink(srcPath, destPath);
                      paths[filename][destPath.slice(1)] = destPath;
                    }
                    doSymLink(srcPath, destPath, false); // we need to continue to look for libs
                  } else {
                    // in this case we need to create a dir
                    if (symlink) FS.mkdir(destPath, 0o777);
                    // and do a another round
                    doSymLink(srcPath, destPath, symlink);
                  }
                } else {
                  // it is a file! We symlink and are done
                  if (symlink) {
                    Module.symlinkAsync(srcPath, destPath);
                    paths[filename][destPath.slice(1)] = destPath;
                  }
                }
              } else {
                // destObj exists!
                if (destObj.isFolder) {
                  if (!srcObj.isFolder)
                    throw new Error('Dest/Src type mismatch DF');
                  // Call me again
                  doSymLink(srcPath, destPath, symlink);
                } else {
                  // ups a destination file exists, we throw, or should we delete?
                  if (symlink)
                    throw new Error('Destination file exists: ' + destPath);
                }
              }
            }
          };
          doSymLink(startDirSrc, startDirDest, true);
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

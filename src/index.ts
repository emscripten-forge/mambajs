import {
  FilesData,
  initUntarJS,
  IUnpackJSAPI
} from '@emscripten-forge/untarjs';
import { fetchJson } from './helper';
import { loadDynlibsFromPackage } from './dynload/dynload';

export interface IEmpackEnvMetaPkg {
  name: string;
  version: string;
  build: string;
  filename_stem: string;
  filename: string;
  url: string;
}

export interface IPackagesInfo {
  pythonPackage?: IEmpackEnvMetaPkg;
  pythonVersion?: number[];
  prefix?: string;
  packages?: IEmpackEnvMetaPkg[];
}

const splitPackages = (packages: IEmpackEnvMetaPkg[]): IPackagesInfo => {
  let pythonPackage: IEmpackEnvMetaPkg | undefined = undefined;
  for (let i = 0; i < packages.length; i++) {
    if (packages[i].name == 'python') {
      pythonPackage = packages[i];
      packages.splice(i, 1);
      break;
    }
  }
  if (pythonPackage) {
    let pythonVersion = pythonPackage.version.split('.').map(x => parseInt(x));
    return { pythonPackage, pythonVersion, packages };
  } else {
    return { packages };
  }
};

export const installCondaPackages = async (
  prefix: string,
  url: string,
  FS: any,
  untarjs: IUnpackJSAPI,
  verbose: boolean
): Promise<FilesData> => {
  let sharedLibs: FilesData = {};
  let newPrefix = prefix;
  if (!url) {
    throw new Error(`There is no file in ${url}`);
  }

  let files = await installCondaPackage(prefix, url, FS, untarjs, verbose);
  if (prefix === '/') {
    newPrefix = '';
  }
  if (Object.keys(files).length !== 0) {
    sharedLibs = getSharedLibs(files, newPrefix);
  }
  return sharedLibs;
};

export const installCondaPackage = async (
  prefix: string,
  url: string,
  FS: any,
  untarjs: IUnpackJSAPI,
  verbose: boolean
): Promise<FilesData> => {
  let files = await untarjs.extract(url);
  let newPrefix = prefix;

  if (Object.keys(files).length !== 0) {
    if (prefix === '/') {
      newPrefix = '';
    }
    if (url.toLowerCase().endsWith('.conda')) {
      let condaPackage: Uint8Array = new Uint8Array();
      let packageInfo: Uint8Array = new Uint8Array();

      Object.keys(files).map(file => {
        if (file.startsWith('pkg-')) {
          condaPackage = files[file];
        } else if (file.startsWith('info-')) {
          packageInfo = files[file];
        }
      });

      if (
        (condaPackage && condaPackage.byteLength === 0) ||
        (packageInfo && packageInfo.byteLength === 0)
      ) {
        throw new Error(`Invalid .conda package ${url}`);
      }
      const condaFiles: FilesData = await untarjs.extractData(condaPackage);
      const packageInfoFiles: FilesData =
        await untarjs.extractData(packageInfo);
      saveCondaMetaFile(packageInfoFiles, newPrefix, FS, verbose);
      saveFiles(FS, { ...condaFiles, ...packageInfoFiles }, newPrefix);
      return condaFiles;
    } else {
      saveCondaMetaFile(files, newPrefix, FS, verbose);
      saveFiles(FS, files, newPrefix);
      return files;
    }
  }

  throw new Error(`There is no file in ${url}`);
};
const getSharedLibs = (files: FilesData, prefix: string): FilesData => {
  let sharedLibs: FilesData = {};

  Object.keys(files).map(file => {
    if (file.endsWith('.so') || file.includes('.so.')) {
      sharedLibs[`${prefix}/${file}`] = files[file];
    }
  });
  return sharedLibs;
};

const getParentDirectory = (filePath: string): string => {
  return filePath.substring(0, filePath.lastIndexOf('/'));
};

const saveFiles = (FS: any, files: FilesData, prefix: string): void => {
  try {
    Object.keys(files).forEach(filename => {
      const dir = getParentDirectory(filename);
      if (!FS.analyzePath(dir).exists) {
        FS.mkdirTree(dir);
      }

      FS.writeFile(`${prefix}/${filename}`, files[filename]);
    });
  } catch (error: any) {
    throw new Error(error?.message);
  }
};

const saveCondaMetaFile = (
  files: FilesData,
  prefix: string,
  FS: any,
  verbose: boolean
): void => {
  let infoData: Uint8Array = new Uint8Array();
  let isCondaMetaFile = checkCondaMetaFile(files);
  if (!isCondaMetaFile) {
    if (verbose) {
      console.log(`Creating and saving conda-meta json`);
    }
    Object.keys(files).map(filename => {
      let regexp = 'index.json';

      if (filename.match(regexp)) {
        infoData = files[filename];
      }
    });
    if (infoData.byteLength !== 0) {
      let info = new TextDecoder('utf-8').decode(infoData);
      try {
        let condaPackageInfo = JSON.parse(info);
        const condaMetaDir = `${prefix}/conda-meta`;
        const path = `${condaMetaDir}/${condaPackageInfo.name}-${condaPackageInfo.version}-${condaPackageInfo.build}.json`;

        const pkgCondaMeta = {
          name: condaPackageInfo.name,
          version: condaPackageInfo.version,
          build: condaPackageInfo.build,
          build_number: condaPackageInfo.build_number
        };

        if (!FS.analyzePath(`${condaMetaDir}`).exists) {
          FS.mkdirTree(`${condaMetaDir}`);
        }

        if (verbose) {
          console.log(
            `Creating conda-meta file for ${condaPackageInfo.name}-${condaPackageInfo.version}-${condaPackageInfo.build} package`
          );
        }
        FS.writeFile(path, JSON.stringify(pkgCondaMeta));
      } catch (error: any) {
        throw new Error(error?.message);
      }
    } else if (verbose) {
      console.log(
        'There is no info folder, imposibly to create a conda meta json file'
      );
    }
  } else {
    let condaMetaFileData: Uint8Array = new Uint8Array();
    let path = '';
    Object.keys(files).forEach(filename => {
      let regexp = 'conda-meta';
      if (filename.match(regexp)) {
        condaMetaFileData = files[filename];
        path = filename;
      }
    });
    let condaMetaDir = `${prefix}/conda-meta`;
    if (!FS.analyzePath(`${condaMetaDir}`).exists) {
      FS.mkdirTree(`${condaMetaDir}`);
    }

    if (verbose) {
      console.log(`Saving conda-meta file ${path}`);
    }

    const json = JSON.stringify(condaMetaFileData);
    const condaMetaFile = new TextEncoder().encode(json);
    FS.writeFile(`${prefix}/${path}`, condaMetaFile);
  }
};

const checkCondaMetaFile = (files: FilesData): boolean => {
  let isCondaMetaFile = false;
  Object.keys(files).forEach(filename => {
    let regexp = 'conda-meta';
    if (filename.match(regexp)) {
      isCondaMetaFile = true;
    }
  });
  return isCondaMetaFile;
};

const initPrimaryPhase = async (
  pythonPackage: IEmpackEnvMetaPkg,
  pythonVersion: number[],
  verbose: boolean,
  untarjs: IUnpackJSAPI,
  Module: any,
  pkgRootUrl: string,
  prefix: string
): Promise<void> => {
  let url = pythonPackage.url
    ? pythonPackage.url
    : `${pkgRootUrl}/${pythonPackage.filename}`;
  if (verbose) {
    console.log(`Installing a python package from ${url}`);
  }
  await installCondaPackage(prefix, url, Module.FS, untarjs, verbose);
  await Module.init_phase_1(prefix, pythonVersion, verbose);
};

export const bootstrapFromEmpackPackedEnvironment = async (
  packagesJsonUrl: string,
  verbose: boolean = true,
  skipLoadingSharedLibs: boolean = false,
  Module: any,
  pkgRootUrl: string,
  bootstrapPython = false
): Promise<IPackagesInfo> => {
  if (verbose) {
    console.log('fetching packages.json from', packagesJsonUrl);
  }

  let empackEnvMeta = await fetchJson(packagesJsonUrl);
  let allPackages: IEmpackEnvMetaPkg[] = empackEnvMeta.packages;
  let prefix = empackEnvMeta.prefix;
  let { pythonPackage, pythonVersion, packages } = splitPackages(allPackages);
  let packagesData = { prefix, pythonVersion };

  const untarjsReady = initUntarJS();
  const untarjs = await untarjsReady;

  if (bootstrapPython && pythonPackage && pythonVersion) {
    await initPrimaryPhase(
      pythonPackage,
      pythonVersion,
      verbose,
      untarjs,
      Module,
      pkgRootUrl,
      prefix
    );
  }

  if (packages?.length) {
    let sharedLibs = await Promise.all(
      packages.map(pkg => {
        const packageUrl = pkg?.url ?? `${pkgRootUrl}/${pkg.filename}`;
        if (verbose) {
          console.log(`Install ${pkg.filename} taken from ${packageUrl}`);
        }
        return installCondaPackages(
          prefix,
          packageUrl,
          Module.FS,
          untarjs,
          verbose
        );
      })
    );
    await waitRunDependencies(Module);
    if (!skipLoadingSharedLibs) {
      loadShareLibs(packages, sharedLibs, prefix, Module);
    }
  }

  if (bootstrapPython && pythonPackage && pythonVersion) {
    globalThis.Module.init_phase_2(prefix, pythonVersion, verbose);
  }

  return packagesData;
};

const loadShareLibs = (
  packages: IEmpackEnvMetaPkg[],
  sharedLibs: FilesData[],
  prefix: string,
  Module: any
): void => {
  packages.map(async (pkg, i) => {
    let packageShareLibs = sharedLibs[i];
    if (Object.keys(packageShareLibs).length) {
      let verifiedWasmSharedLibs: FilesData = {};
      Object.keys(packageShareLibs).map(path => {
        const isValidWasm = checkWasmMagicNumber(packageShareLibs[path]);
        if (isValidWasm) {
          verifiedWasmSharedLibs[path] = packageShareLibs[path];
        }
      });
      if (Object.keys(verifiedWasmSharedLibs).length) {
        await loadDynlibsFromPackage(
          prefix,
          pkg.name,
          false,
          verifiedWasmSharedLibs,
          Module
        );
      }
    }
  });
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

const checkWasmMagicNumber = (uint8Array: Uint8Array): boolean => {
  const WASM_MAGIC_NUMBER = [0x00, 0x61, 0x73, 0x6d];

  return (
    uint8Array[0] === WASM_MAGIC_NUMBER[0] &&
    uint8Array[1] === WASM_MAGIC_NUMBER[1] &&
    uint8Array[2] === WASM_MAGIC_NUMBER[2] &&
    uint8Array[3] === WASM_MAGIC_NUMBER[3]
  );
};

export default {
  installCondaPackage,
  bootstrapFromEmpackPackedEnvironment
};

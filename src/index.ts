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
}

const getPythonVersion = (packages: IEmpackEnvMetaPkg[]): IPackagesInfo => {
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
    return { pythonPackage, pythonVersion };
  } else {
    return {};
  }
};

export const installCondaPackage = async (
  prefix: string,
  url: string,
  FS: any,
  untarjs: IUnpackJSAPI,
  verbose: boolean
): Promise<FilesData> => {
  let sharedLibs: FilesData = {};
  let files = await untarjs.extract(url);

  if (Object.keys(files).length !== 0) {
    if (prefix === '/') {
      prefix = '';
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

      createCondaMetaFile(packageInfoFiles, prefix, FS, verbose);
      saveFiles(prefix, FS, { ...condaFiles, ...packageInfoFiles }, verbose);
      sharedLibs = getSharedLibs(condaFiles);
    } else {
      createCondaMetaFile(files, prefix, FS, verbose);
      saveFiles(prefix, FS, files, verbose);
      sharedLibs = getSharedLibs(files);
    }

    return sharedLibs;
  }

  throw new Error(`There is no file in ${url}`);
};

const getSharedLibs = (files: FilesData): FilesData => {
  let sharedLibs: FilesData = {};

  Object.keys(files).map(file => {
    if (file.endsWith('.so') || file.includes('.so.')) {
      sharedLibs[file] = files[file];
    }
  });
  return sharedLibs;
};

const saveFiles = (
  prefix: string,
  FS: any,
  files: FilesData,
  verbose: boolean
): void => {
  try {
    ['site-packages', 'etc', 'share'].forEach(folder => {
      let folderDest = `${prefix}/${folder}`;
      if (folder === 'site-packages') {
        folderDest = `${prefix}/lib/python3.11/site-packages`;
      }
      savingFiles(files, folder, folderDest, FS, verbose);
    });
  } catch (error) {
    console.error(error);
  }
};

const savingFiles = (
  files: FilesData,
  folder: string,
  folderDest: string,
  FS: any,
  verbose: boolean
) => {
  Object.keys(files).forEach(filename => {
    const regexp = new RegExp(`^${folder}`);
    if (filename.match(regexp)) {
      if (!FS.analyzePath(folderDest).exists) {
        FS.mkdirTree(folderDest);
      }
      if (verbose) {
        console.log(`Writing a file for ${folderDest} folder`, filename);
      }
      writeFile(files[filename], filename, FS, folder, folderDest, verbose);
    }
  });
};

const writeFile = (
  data: Uint8Array,
  fullPath: string,
  FS: any,
  folder: string,
  folderDest: string,
  verbose: boolean
): void => {
  let fileName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
  let directoryPathes = fullPath.replace(new RegExp(`\/${fileName}`), '');
  if (directoryPathes.match(folder)) {
    directoryPathes = directoryPathes.replace(new RegExp(`${folder}`), '');
  }
  let destPath = `${folderDest}${directoryPathes}/`;
  if (destPath) {
    if (!FS.analyzePath(destPath).exists) {
      FS.mkdirTree(destPath);
    }
  }

  destPath = `${destPath}${fileName}`;
  if (verbose) {
    console.log(`Saving files into ${destPath}`);
  }

  let encodedData = new TextDecoder('utf-8').decode(data);
  FS.writeFile(destPath, encodedData);
};

const createCondaMetaFile = (
  files: FilesData,
  prefix: string,
  FS: any,
  verbose: boolean
) => {
  let infoData: Uint8Array = new Uint8Array();

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
    } catch (error) {
      console.error(error);
    }
  } else {
    console.log('There is no info folder');
  }
};

export const bootstrapFromEmpackPackedEnvironment = async (
  packagesJsonUrl: string,
  verbose: boolean = true,
  skipLoadingSharedLibs: boolean = false,
  Module: any,
  pkgRootUrl: string
): Promise<IPackagesInfo> => {
  if (verbose) {
    console.log('fetching packages.json from', packagesJsonUrl);
  }

  let empackEnvMeta = await fetchJson(packagesJsonUrl);
  let packages: IEmpackEnvMetaPkg[] = empackEnvMeta.packages;
  let prefix = empackEnvMeta.prefix;
  let pythonData = getPythonVersion(packages);
  pythonData.prefix = prefix;

  if (verbose) {
    console.log('installCondaPackage');
  }
  const untarjsReady = initUntarJS();
  const untarjs = await untarjsReady;
  let sharedLibs = await Promise.all(
    packages.map(pkg => {
      const packageUrl =
      pkg?.url ?? `${pkgRootUrl}/${pkg.filename}`;
      if (verbose) {
        console.log(
          `Install ${pkg.filename} taken from ${packageUrl}`
        );
      }
      return installCondaPackage(prefix, packageUrl, Module.FS, untarjs, verbose);
    })
  );
  await waitRunDependencies(Module);
  if (!skipLoadingSharedLibs) {
    loadShareLibs(packages, sharedLibs, prefix, Module);
  }
  return pythonData;
};

const loadShareLibs = (
  packages: IEmpackEnvMetaPkg[],
  sharedLibs: FilesData[],
  prefix: string,
  Module: any
) => {
  packages.map((pkg, i) => {
    let packageShareLibs = sharedLibs[i];
    if (Object.keys(packageShareLibs).length) {
      loadDynlibsFromPackage(prefix, pkg.name, false, packageShareLibs, Module);
    }
  });
};

const waitRunDependencies = (Module: any) => {
  const promise = new Promise<void>((r) => {
      Module.monitorRunDependencies = (n) => {
          if (n === 0) {
              r();
          }
      };
  });
  Module.addRunDependency("dummy");
  Module.removeRunDependency("dummy");
  return promise;
}

export default {
  installCondaPackage,
  bootstrapFromEmpackPackedEnvironment
};

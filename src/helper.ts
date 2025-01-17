import { FilesData, IUnpackJSAPI } from '@emscripten-forge/untarjs';

export interface IEmpackEnvMetaPkg {
  name: string;
  version: string;
  build: string;
  filename_stem: string;
  filename: string;
  url: string;
}

export interface IEmpackEnvMeta {
  prefix: string;
  packages: IEmpackEnvMetaPkg[];
}

// export async function fetchJson(url: string): Promise<any> {
//   let response = await fetch(url);
//   if (!response.ok) {
//     throw new Error(`HTTP error! status: ${response.status}`);
//   }
//   let json = await response.json();
//   return json;
// }

export function getParentDirectory(filePath: string): string {
  return filePath.substring(0, filePath.lastIndexOf('/'));
}

export function getSharedLibs(files: FilesData, prefix: string): FilesData {
  let sharedLibs: FilesData = {};

  Object.keys(files).map(file => {
    if (file.endsWith('.so') || file.includes('.so.')) {
      sharedLibs[`${prefix}/${file}`] = files[file];
    }
  });

  return sharedLibs;
}

export function isCondaMeta(files: FilesData): boolean {
  let isCondaMetaFile = false;
  Object.keys(files).forEach(filename => {
    let regexp = 'conda-meta';
    if (filename.match(regexp)) {
      isCondaMetaFile = true;
    }
  });
  return isCondaMetaFile;
}

export function getPythonVersion(
  packages: IEmpackEnvMetaPkg[]
): number[] | undefined {
  let pythonPackage: IEmpackEnvMetaPkg | undefined = undefined;
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

export function saveFiles(FS: any, files: FilesData, prefix: string): void {
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
}

export async function bootstrapPythonPackage(
  pythonPackage: IEmpackEnvMetaPkg,
  pythonVersion: number[],
  verbose: boolean,
  untarjs: IUnpackJSAPI,
  Module: any,
  pkgRootUrl: string,
  prefix: string
): Promise<void> {
  let url = pythonPackage.url
    ? pythonPackage.url
    : `${pkgRootUrl}/${pythonPackage.filename}`;
  if (verbose) {
    console.log(`Installing a python package from ${url}`);
  }
  await installCondaPackage(prefix, url, Module.FS, untarjs, verbose);
  await Module.init_phase_1(prefix, pythonVersion, verbose);
}

export async function installCondaPackage(
  prefix: string,
  url: string,
  FS: any,
  untarjs: IUnpackJSAPI,
  verbose: boolean
): Promise<FilesData> {
  let sharedLibs: FilesData = {};
  if (!url) {
    throw new Error(`There is no file in ${url}`);
  }

  let files = await untarjs.extract(url);
  let installedFiles: FilesData | undefined = undefined;
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
      installedFiles = condaFiles;
    } else {
      saveCondaMetaFile(files, newPrefix, FS, verbose);
      saveFiles(FS, files, newPrefix);
      installedFiles = files;
    }
  }

  if (!installedFiles) {
    throw new Error(`There is no file in ${url}`);
  }

  if (prefix === '/') {
    newPrefix = '';
  }
  if (Object.keys(installedFiles).length !== 0) {
    sharedLibs = getSharedLibs(installedFiles, newPrefix);
  }
  return sharedLibs;
}

export function saveCondaMetaFile(
  files: FilesData,
  prefix: string,
  FS: any,
  verbose: boolean
): void {
  let infoData: Uint8Array = new Uint8Array();
  let isCondaMetaFile = isCondaMeta(files);
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
}

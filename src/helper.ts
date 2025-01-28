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

/**
 * Shared libraries. list of .so files
 */
export type TSharedLibs = string[];

/**
 * Shared libraries. A map package name -> list of .so files
 */
export type TSharedLibsMap = { [pkgName: string]: TSharedLibs };

export function getParentDirectory(filePath: string): string {
  return filePath.substring(0, filePath.lastIndexOf('/'));
}

export function getSharedLibs(files: FilesData, prefix: string): TSharedLibs {
  let sharedLibs: TSharedLibs = [];

  Object.keys(files).map(file => {
    if (
      (file.endsWith('.so') || file.includes('.so.')) &&
      checkWasmMagicNumber(files[file])
    ) {
      sharedLibs.push(`${prefix}/${file}`);
    }
  });

  return sharedLibs;
}

export function checkWasmMagicNumber(uint8Array: Uint8Array): boolean {
  const WASM_MAGIC_NUMBER = [0x00, 0x61, 0x73, 0x6d];

  return (
    uint8Array[0] === WASM_MAGIC_NUMBER[0] &&
    uint8Array[1] === WASM_MAGIC_NUMBER[1] &&
    uint8Array[2] === WASM_MAGIC_NUMBER[2] &&
    uint8Array[3] === WASM_MAGIC_NUMBER[3]
  );
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

export function saveFilesIntoEmscriptenFS(
  FS: any,
  files: FilesData,
  prefix: string
): void {
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

/**
 * Untar conda or empacked package, given a URL to it. This will also do prefix relocation.
 * @param url The URL to the package
 * @param untarjs The current untarjs instance
 * @param verbose Whether it's verbose or not
 * @param generateCondaMeta Whether or not to generate conda meta files
 * @returns the files to install
 */
export async function untarCondaPackage(
  url: string,
  untarjs: IUnpackJSAPI,
  verbose = false,
  generateCondaMeta = false
): Promise<FilesData> {
  const extractedFiles = await untarjs.extract(url);

  if (Object.keys(extractedFiles).length !== 0) {
    if (url.toLowerCase().endsWith('.conda')) {
      let condaPackage: Uint8Array = new Uint8Array();
      let packageInfo: Uint8Array = new Uint8Array();

      Object.keys(extractedFiles).map(file => {
        if (file.startsWith('pkg-')) {
          condaPackage = extractedFiles[file];
        } else if (file.startsWith('info-')) {
          packageInfo = extractedFiles[file];
        }
      });

      if (
        (condaPackage && condaPackage.byteLength === 0) ||
        (packageInfo && packageInfo.byteLength === 0)
      ) {
        throw new Error(`Invalid .conda package ${url}`);
      }
      const condaFiles: FilesData = await untarjs.extractData(condaPackage);

      if (generateCondaMeta) {
        return {
          ...condaFiles,
          ...getCondaMetaFile(extractedFiles, verbose)
        };
      } else {
        return condaFiles;
      }
    } else {
      // This will happen for empacked packages, there are already
      // properly relocated and can be installed directly without further processing
      return extractedFiles;
    }
  }

  return {};
}

/**
 * Given a conda package, get the generated conda meta files
 * @param files The conda package files
 * @param verbose Whether to be verbose or not
 * @returns The generated conda-meta files
 */
export function getCondaMetaFile(
  files: FilesData,
  verbose: boolean
): FilesData {
  let infoData: Uint8Array = new Uint8Array();
  let isCondaMetaFile = isCondaMeta(files);
  if (!isCondaMetaFile) {
    if (verbose) {
      console.log(`Creating conda-meta json`);
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
        const path = `conda-meta/${condaPackageInfo.name}-${condaPackageInfo.version}-${condaPackageInfo.build}.json`;

        const pkgCondaMeta = {
          name: condaPackageInfo.name,
          version: condaPackageInfo.version,
          build: condaPackageInfo.build,
          build_number: condaPackageInfo.build_number
        };

        if (verbose) {
          console.log(
            `Creating conda-meta file for ${condaPackageInfo.name}-${condaPackageInfo.version}-${condaPackageInfo.build} package`
          );
        }

        const json = JSON.stringify(pkgCondaMeta);
        const condaMetaFile = new TextEncoder().encode(json);

        return { [path]: condaMetaFile };
      } catch (error: any) {
        throw new Error(error?.message);
      }
    } else if (verbose) {
      console.log(
        'There is no info folder, imposibly to create a conda meta json file'
      );
      return {};
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
    // let condaMetaDir = `${prefix}/conda-meta`;
    // if (!FS.analyzePath(`${condaMetaDir}`).exists) {
    //   FS.mkdirTree(`${condaMetaDir}`);
    // }

    if (verbose) {
      console.log(`Saving conda-meta file ${path}`);
    }

    const json = JSON.stringify(condaMetaFileData);
    const condaMetaFile = new TextEncoder().encode(json);
    return { [path]: condaMetaFile };
  }

  return {};
}

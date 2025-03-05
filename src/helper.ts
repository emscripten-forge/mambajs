import { FilesData, IUnpackJSAPI } from '@emscripten-forge/untarjs';

export interface ILogger {
  log(...msg: any[]): void;
  warn(...msg: any[]): void;
  error(...msg: any[]): void;
}

export interface ISolvedPackage {
  name: string;
  version: string;
  build_number?: string;
  repo_url?: string;
  url: string;
}

export interface ISolvedPackages {
  [key: string]: ISolvedPackage;
}

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

function replaceString(
  data: Uint8Array,
  search: string,
  replacement: string
): Uint8Array {
  const searchBytes = new TextEncoder().encode(search);
  const replacementBytes = new TextEncoder().encode(replacement);

  const maxOutputSize =
    data.length +
    (replacementBytes.length - searchBytes.length) *
      countOccurrences(data, searchBytes);
  const output = new Uint8Array(maxOutputSize);

  let i = 0,
    j = 0;
  while (i < data.length) {
    if (matchesAt(data, searchBytes, i)) {
      output.set(replacementBytes, j);
      j += replacementBytes.length;
      i += searchBytes.length;
    } else {
      output[j++] = data[i++];
    }
  }

  return output.subarray(0, j);
}

function countOccurrences(data: Uint8Array, searchBytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i <= data.length - searchBytes.length; i++) {
    if (matchesAt(data, searchBytes, i)) {
      count++;
      i += searchBytes.length - 1;
    }
  }
  return count;
}

function matchesAt(
  data: Uint8Array,
  searchBytes: Uint8Array,
  pos: number
): boolean {
  if (pos + searchBytes.length > data.length) return false;
  return data
    .subarray(pos, pos + searchBytes.length)
    .every((byte, idx) => byte === searchBytes[idx]);
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

export interface IUntarCondaPackageOptions {
  /**
   * The URL to the package
   */
  url: string;

  /**
   * The current untarjs instance
   */
  untarjs: IUnpackJSAPI;

  /**
   * Whether the functino will be verbose or not
   */
  verbose?: boolean;

  /**
   * Whether or not to generate conda-meta files
   */
  generateCondaMeta?: boolean;

  /**
   * The prefix for relocation
   */
  relocatePrefix?: string;

  /**
   * The environment Python version, if it is there
   */
  pythonVersion?: number[];
}

/**
 * Untar conda or empacked package, given a URL to it. This will also do prefix relocation.
 * @param options The functino options
 * @returns the files to install
 */
export async function untarCondaPackage(
  options: IUntarCondaPackageOptions
): Promise<FilesData> {
  const {
    url,
    untarjs,
    verbose,
    generateCondaMeta,
    relocatePrefix,
    pythonVersion
  } = options;

  const extractedFiles = await untarjs.extract(url);

  const { info, pkg } = await splitPackageInfo(url, extractedFiles, untarjs);

  // Prefix relocation
  if (info['info/paths.json']) {
    const paths = JSON.parse(
      new TextDecoder('utf-8').decode(info['info/paths.json'])
    );
    for (const filedesc of paths['paths']) {
      // If it doesn't need to be relocated, or if the file has
      // been filtered out from the package, bail early
      if (!filedesc['prefix_placeholder'] || !pkg[filedesc['_path']]) {
        continue;
      }

      const prefixPlaceholder = filedesc['prefix_placeholder'].endsWith('/')
        ? filedesc['prefix_placeholder']
        : `${filedesc['prefix_placeholder']}/`;
      pkg[filedesc['_path']] = replaceString(
        pkg[filedesc['_path']],
        prefixPlaceholder,
        relocatePrefix || ''
      );
    }
  }

  // Fix site-packages prefix
  if (pythonVersion) {
    for (const file of Object.keys(pkg)) {
      if (file.startsWith('site-packages')) {
        pkg[`/lib/python${pythonVersion[0]}.${pythonVersion[1]}/${file}`] =
          pkg[file];
        delete pkg[file];
      }
    }
  }

  if (generateCondaMeta) {
    return {
      ...pkg,
      ...getCondaMetaFile(info, !!verbose)
    };
  }

  return pkg;
}

/**
 * Split package info from actual package files
 * @param filename The original filename
 * @param files The package files
 * @param untarjs The current untarjs instance
 * @returns Splitted files between info and actual package files
 */
export async function splitPackageInfo(
  filename: string,
  files: FilesData,
  untarjs: IUnpackJSAPI
): Promise<{ info: FilesData; pkg: FilesData }> {
  let info: FilesData = {};
  let pkg: FilesData = {};

  // For .conda files, extract info and pkg separately
  if (filename.toLowerCase().endsWith('.conda')) {
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
      throw new Error(`Invalid .conda package ${filename}`);
    }

    pkg = await untarjs.extractData(condaPackage);
    info = await untarjs.extractData(packageInfo);
  } else {
    // For tar.gz packages, extract everything from the info directory
    Object.keys(files).map(file => {
      if (file.startsWith('info/')) {
        info[file] = files[file];
      } else {
        pkg[file] = files[file];
      }
    });
  }

  return { info, pkg };
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

    if (verbose) {
      console.log(`Saving conda-meta file ${path}`);
    }

    const json = JSON.stringify(condaMetaFileData);
    const condaMetaFile = new TextEncoder().encode(json);
    return { [path]: condaMetaFile };
  }

  return {};
}

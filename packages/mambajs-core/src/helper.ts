import { FilesData, IUnpackJSAPI } from '@emscripten-forge/untarjs';
import { parse } from 'yaml';

export interface ILogger {
  log(...msg: any[]): void;
  warn(...msg: any[]): void;
  error(...msg: any[]): void;
}

export interface ISolvedPackage {
  name: string;
  version: string;
  repo_url?: string;
  url: string;
  build_number?: number;
  repo_name?: string;
  build_string?: string;
  subdir?: string;
  depends?: string[];
}

export interface ISolvedPackages {
  [key: string]: ISolvedPackage;
}

export interface IEnvPackages {
  condaPackages: ISolvedPackages;
  pipPackages: ISolvedPackages;
}

export interface IEnv {
  specs: string[];
  channels: string[];
  packages: IEnvPackages;
}

export interface IEmpackEnvMetaPkg {
  name: string;
  version: string;
  build: string;
  channel: string;
  filename_stem: string;
  filename: string;
  url: string;
  depends: [];
  subdir: string;
}

export interface IEmpackEnvMetaMountPoint {
  name: string;
  filename: string;
}

export interface IEmpackEnvMeta {
  prefix: string;
  packages: IEmpackEnvMetaPkg[];
  specs?: string[];
  channels?: string[];
  mounts?: IEmpackEnvMetaMountPoint[];
}

/**
 * Shared libraries. list of .so files
 */
export type TSharedLibs = string[];

/**
 * Shared libraries. A map package name -> list of .so files
 */
export type TSharedLibsMap = { [pkgName: string]: TSharedLibs };
export interface IBootstrapData {
  sharedLibs: TSharedLibsMap;
  paths: { [key: string]: string };
  untarjs: IUnpackJSAPI;
}

export function parseEnvYml(envYml: string) {
  const data = parse(envYml);
  const packages = data.dependencies ? data.dependencies : [];
  const prefix: string = data.name ? data.name : '/';
  const channels: Array<string> = data.channels ? data.channels : [];

  const specs: string[] = [];
  let pipSpecs: string[] = [];
  for (const pkg of packages) {
    if (typeof pkg !== 'string' && Array.isArray(pkg.pip)) {
      pipSpecs = pkg.pip;
    }
    if (typeof pkg === 'string') {
      specs.push(pkg);
    }
  }
  return { prefix, specs, pipSpecs, channels };
}

export function getParentDirectory(filePath: string): string {
  return filePath.substring(0, filePath.lastIndexOf('/'));
}

export function getSharedLibs(files: FilesData, prefix: string): TSharedLibs {
  const sharedLibs: TSharedLibs = [];

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

function hasNullBytes(data: Uint8Array): boolean {
  return data.some(byte => byte === 0);
}

function replaceStringWithZeroPadding(
  input: Uint8Array,
  search: string,
  replacement: string
): Uint8Array {
  const encoder = new TextEncoder();
  const searchBytes = encoder.encode(search);
  const replacementBytes = encoder.encode(replacement);

  const searchLength = searchBytes.length;
  const replacementLength = replacementBytes.length;
  const inputLength = input.length;

  outer: for (let i = 0; i <= inputLength - searchLength; i++) {
    for (let j = 0; j < searchLength; j++) {
      if (input[i + j] !== searchBytes[j]) {
        continue outer; // exit early if mismatch
      }
    }

    // Match found, do replacement
    for (let j = 0; j < replacementLength; j++) {
      input[i + j] = replacementBytes[j];
    }

    for (let j = replacementLength; j < searchLength; j++) {
      input[i + j] = 0;
    }

    i += searchLength - 1;
  }

  return input;
}

function replaceString(
  data: Uint8Array,
  search: string,
  replacement: string
): Uint8Array {
  const encoder = new TextEncoder();
  const searchBytes = encoder.encode(search);
  const replacementBytes = encoder.encode(replacement);

  const searchLen = searchBytes.length;
  const replacementLen = replacementBytes.length;

  // Estimate output size: assume worst-case every byte is a match
  const estimatedMaxSize =
    data.length +
    Math.max(
      0,
      (replacementLen - searchLen) * Math.floor(data.length / searchLen)
    );
  const output = new Uint8Array(estimatedMaxSize);

  let i = 0;
  let j = 0;

  while (i <= data.length - searchLen) {
    let matched = true;
    for (let k = 0; k < searchLen; k++) {
      if (data[i + k] !== searchBytes[k]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      output.set(replacementBytes, j);
      j += replacementLen;
      i += searchLen;
    } else {
      output[j++] = data[i++];
    }
  }

  // Copy any trailing unmatched bytes
  while (i < data.length) {
    output[j++] = data[i++];
  }

  return output.subarray(0, j);
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
    const regexp = 'conda-meta';
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
 * Recursive function that removes parent directories if they are empty
 */
function removeParentDirIfEmpty(FS: any, path: string) {
  const pathInfo = FS.analyzePath(path);

  if (!pathInfo.exists) {
    return;
  }

  // only contains . and ..
  if (FS.readdir(path).length === 2) {
    FS.rmdir(path);

    removeParentDirIfEmpty(FS, pathInfo.parentPath);
  }
}

export function removeFilesFromEmscriptenFS(FS: any, paths: string[]): void {
  try {
    const pwd = FS.cwd();
    FS.chdir('/');
    paths.forEach(path => {
      const pathInfo = FS.analyzePath(path);

      if (pathInfo.exists) {
        if (pathInfo.isDir) {
          FS.rmdir(path);
        } else {
          FS.unlink(path);
        }

        removeParentDirIfEmpty(FS, pathInfo.parentPath);
      }
    });
    FS.chdir(pwd);
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

      // TextDecoder cannot decode the null bytes (zero-padding), so we cannot do the zero-padding
      // for any file that will be text decoded (.json, .py etc)
      // We only do the zero-padding on detected binary files. Is there a better way to detect them?
      if (hasNullBytes(pkg[filedesc['_path']])) {
        pkg[filedesc['_path']] = replaceStringWithZeroPadding(
          pkg[filedesc['_path']],
          prefixPlaceholder,
          relocatePrefix || ''
        );
      } else {
        pkg[filedesc['_path']] = replaceString(
          pkg[filedesc['_path']],
          prefixPlaceholder,
          relocatePrefix || ''
        );
      }
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
  const isCondaMetaFile = isCondaMeta(files);
  if (!isCondaMetaFile) {
    if (verbose) {
      console.log(`Creating conda-meta json`);
    }

    Object.keys(files).map(filename => {
      const regexp = 'index.json';

      if (filename.match(regexp)) {
        infoData = files[filename];
      }
    });
    if (infoData.byteLength !== 0) {
      const info = new TextDecoder('utf-8').decode(infoData);
      try {
        const condaPackageInfo = JSON.parse(info);
        const path = `conda-meta/${condaPackageInfo.name}-${condaPackageInfo.version}-${condaPackageInfo.build}.json`;

        const pkgCondaMeta = {
          name: condaPackageInfo.name,
          version: condaPackageInfo.version,
          build: condaPackageInfo.build,
          license: condaPackageInfo.license
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
      const regexp = 'conda-meta';
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

export function splitPipPackages(installed?: ISolvedPackages) {
  const installedCondaPackages: ISolvedPackages = {};
  const installedPipPackages: ISolvedPackages = {};
  if (installed) {
    Object.keys(installed).filter((filename: string) => {
      const pkg = installed[filename];
      if (pkg.repo_name !== 'PyPi') {
        installedCondaPackages[filename] = pkg;
      } else {
        installedPipPackages[filename] = pkg;
      }
    });
  }
  return { installedCondaPackages, installedPipPackages };
}

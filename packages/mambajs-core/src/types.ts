import type { IUnpackJSAPI } from '@emscripten-forge/untarjs';

export { ILockV1 as ILock } from './_interface/lock.v1.0.0';

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

export const DEFAULT_CHANNELS = ['emscripten-forge', 'conda-forge'];
export const ALIASES = {
  'emscripten-forge': 'https://prefix.dev/emscripten-forge-dev',
  'conda-forge': 'https://prefix.dev/conda-forge'
};

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

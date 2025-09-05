import type { IUnpackJSAPI } from '@emscripten-forge/untarjs';
import { ILock } from './types';

export type { ILockV1 as ILock } from './_interface/lock.v1.0.0';

export interface ILogger {
  log(...msg: any[]): void;
  warn(...msg: any[]): void;
  error(...msg: any[]): void;
}

// Some helper types
export type ISolvedPackage = ILock['packages'][keyof ILock['packages']];
export type ISolvedPackages = ILock['packages'];
export type ISolvedPipPackage = ILock['pipPackages'][keyof ILock['pipPackages']];
export type ISolvedPipPackages = ILock['pipPackages'];

export const DEFAULT_PLATFORM: ILock['platform'] = 'emscripten-wasm32';
export const DEFAULT_CHANNEL_PRIORITY: ILock['channel_priority'] = ['emscripten-forge', 'conda-forge'];
export const DEFAULT_CHANNELS: ILock['channels'] = {
  'emscripten-forge': [{
    'url': 'https://prefix.dev/emscripten-forge-dev',
    'protocol': 'https'
  }],
  'conda-forge': [{
    'url': 'https://prefix.dev/conda-forge',
    'protocol': 'https'
  }],
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
  lock: ILock,
  sharedLibs: TSharedLibsMap;
  paths: { [key: string]: string };
  untarjs: IUnpackJSAPI;
}

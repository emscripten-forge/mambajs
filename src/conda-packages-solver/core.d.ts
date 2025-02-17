declare const core: {
  (options: { locateFile: (path: string) => string }): Promise<ICorePicomamba>;
};

declare class PicoMambaCore {
  constructor();

  loadRepodata(path: string, repoName: string): void;
  loadInstalled(prefix: string): void;
  solve(packages: Array<string>, config: any): any;
}

declare class PicoMambaCoreSolveConfig {
  constructor();
}

declare class PackageList extends Array<string> {
  constructor();
  push_back(item: string): void;
  delete(): void;
}

export interface ICorePicomamba {
  PackageList: typeof PackageList;
  PicoMambaCore: typeof PicoMambaCore;
  PicoMambaCoreSolveConfig: typeof PicoMambaCoreSolveConfig;
  _malloc(size: number): number;
  FS: any;
}

export default core;

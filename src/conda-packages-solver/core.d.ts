declare const core: {
  (options: { locateFile: (path: string) => string }): Promise<ICorePicomamba>;
};

interface SolvablePackage {
  name: string;
  version: string;
  build_string: string;
  build_number: number;
}

declare class InstalledPackages extends Array<SolvablePackage> {
  constructor();
  push_back(item: SolvablePackage): void;
  delete(): void;
}

declare class PicoMambaCore {
  constructor();

  loadRepodata(path: string, repoName: string): void;
  loadInstalled(prefix: string, installedPackages: InstalledPackages): void;
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
  InstalledPackages: typeof InstalledPackages;
  PicoMambaCoreSolveConfig: typeof PicoMambaCoreSolveConfig;
  _malloc(size: number): number;
  FS: any;
}

export default core;

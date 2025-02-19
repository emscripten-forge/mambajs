import initializeWasm from './core-wasm';
import { parse } from 'yaml';
import { ILogger } from './types';

interface IRepoDataLink {
  [key: string]: string;
}

type RepoName =
  | 'noarch-conda-forge'
  | 'noarch-emscripten-forge'
  | 'arch-emscripten-forge';

type Repodata = { [key: string]: Uint8Array };

export interface ITransactionItem {
  name: string;
  evr: string;
  build_string: string;
  build_number: number;
  repo_name: RepoName;
  filename: string;
}

export interface ISolvedPackage {
  name: string;
  version: string;
  url: string;
}

export interface ISolvedPackages {
  [key: string]: ISolvedPackage;
}

export const initEnv = async (logger: ILogger, locateWasm?: (file: string) => string) => {
  logger.log('Loading solver ...');

  const wasmModule = await initializeWasm(locateWasm);
  const instance = new wasmModule.PicoMambaCore();

  const links: Array<IRepoDataLink> = [
    {
      'noarch-conda-forge':
        'https://repo.prefix.dev/conda-forge/noarch/repodata.json'
    },
    {
      'noarch-emscripten-forge':
        'https://repo.prefix.dev/emscripten-forge-dev/noarch/repodata.json'
    },
    {
      'arch-emscripten-forge':
        'https://repo.prefix.dev/emscripten-forge-dev/emscripten-wasm32/repodata.json'
    }
  ];

  const solve = async (envYml: string) => {
    const startSolveTime = performance.now();
    let result: any = undefined;
    const data = parse(envYml);
    const prefix = data.name ? data.name : '/';
    const packages = data?.dependencies ? data.dependencies : [];
    const repodata = await getRepodata(links);

    const specs: string[] = [];
    // Remove pip dependencies which do not impact solving
    for (const pkg of packages) {
      if (typeof pkg === 'string') {
        specs.push(pkg);
      }
    }

    if (Object.keys(repodata)) {
      loadRepodata(repodata);
      result = getSolvedPackages(specs, prefix, repodata);
    }
    const endSolveTime = performance.now();
    logger.log(
      `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
    );

    return result;
  };

  const getRepodata = async (
    repodataUrls: Array<IRepoDataLink>
  ): Promise<Repodata> => {
    const repodataTotal: Repodata = {};
    await Promise.all(
      repodataUrls.map(async item => {
        const repoName = Object.keys(item)[0];

        logger.log('Downloading repodata', repoName, '...');

        const url = item[repoName];
        if (url) {
          const data = await fetchRepodata(url);
          repodataTotal[repoName] = data;
        }
      })
    );

    return repodataTotal;
  };

  const fetchRepodata = async (url: string): Promise<Uint8Array> => {
    const options = {
      headers: { 'Accept-Encoding': 'gzip' }
    };

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  };

  const loadRepodata = (repodata: Repodata): void => {
    Object.keys(repodata).map(repoName => {
      logger.log(`Load repodata ${repoName} ...`);

      const tmpPath = `tmp/${repoName}_repodata_tmp.json`;
      const repodataItem = repodata[repoName];

      wasmModule.FS.writeFile(tmpPath, repodataItem);
      instance.loadRepodata(tmpPath, repoName);
      wasmModule.FS.unlink(tmpPath);
    });
  };

  const getSolvedPackages = (
    packages: Array<string>,
    prefix: string,
    repodata: any
  ) => {
    logger.log('Solving environment ...');

    if (!wasmModule.FS.analyzePath(prefix).exists) {
      wasmModule.FS.mkdir(prefix);
      wasmModule.FS.mkdir(`${prefix}/conda-meta`);
      wasmModule.FS.mkdir(`${prefix}/arch`);
      wasmModule.FS.mkdir(`${prefix}/noarch`);
    }

    const config = new wasmModule.PicoMambaCoreSolveConfig();

    const packageListVector = new wasmModule.PackageList();
    packages.forEach((item: string) => {
      packageListVector.push_back(item);
    });

    const rawTransaction = instance.solve(packageListVector, config);
    packageListVector.delete();

    return transform(rawTransaction, repodata);
  };

  const transform = (rawTransaction: any, repodata: Repodata) => {
    const rawInstall = rawTransaction.install;
    const solvedPackages: ISolvedPackages = {};

    const repoLinks = {
      'noarch-conda-forge': 'https://repo.prefix.dev/conda-forge/noarch/',
      'noarch-emscripten-forge':
        'https://repo.prefix.dev/emscripten-forge-dev/noarch/',
      'arch-emscripten-forge':
        'https://repo.prefix.dev/emscripten-forge-dev/emscripten-wasm32/'
    };

    rawInstall.forEach((item: ITransactionItem) => {
      solvedPackages[item.filename] = {
        name: item.name,
        version: item.evr,
        url: `${repoLinks[item.repo_name]}${item.filename}`
      };
    });

    return solvedPackages;
  };

  return {
    solve
  };
};
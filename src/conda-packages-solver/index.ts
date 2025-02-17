import initializeWasm from './core-wasm';
import { parse } from 'yaml';

interface IRepoDataLink {
  [key: string]: string;
}

type RepoName =
  | 'noarch-conda-forge'
  | 'noarch-emscripten-forge'
  | 'arch-emscripten-forge';

export interface ITransactionItem {
  name: string;
  evr: string;
  build_string: string;
  build_number: number;
  repo_name: RepoName;
}

export interface ISolvedPackages {
  [key: string]: {
    name: string;
    version: string;
    url: string;
  };
}

export const initEnv = async () => {
  const wasmModule = await initializeWasm();
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

    return result;
  };

  const getRepodata = async (repodataUrls: Array<IRepoDataLink>) => {
    const repodataTotal: { [key: string]: unknown } = {};
    await Promise.all(
      repodataUrls.map(async item => {
        const repoName = Object.keys(item)[0];
        const url = item[repoName];
        if (url) {
          const data = await fetchRepodata(url);
          repodataTotal[repoName] = data;
        }
      })
    );

    return repodataTotal;
  };

  const fetchData = async (url: string, options: any) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: unknown = await response.json();
    if (typeof data === 'object' && data !== null) {
      return data;
    } else {
      return {};
    }
  };

  const fetchRepodata = async (url: string) => {
    const options = {
      headers: { 'Accept-Encoding': 'gzip' }
    };

    return await fetchData(url, options);
  };

  const loadRepodata = (repodata: any): void => {
    Object.keys(repodata).map(repoName => {
      const tmpPath = `tmp/${repoName}_repodata_tmp.json`;
      const repodataItem = repodata[repoName];

      wasmModule.FS.writeFile(
        tmpPath,
        new TextEncoder().encode(JSON.stringify(repodataItem))
      );
      instance.loadRepodata(tmpPath, repoName);
      wasmModule.FS.unlink(tmpPath);
    });
  };

  const getSolvedPackages = (
    packages: Array<string>,
    prefix: string,
    repodata: any
  ) => {
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

  const transform = (rawTransaction: any, repodata: any) => {
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
      let extention = '.conda';
      const packageName = `${item.name}-${item.evr}-${item.build_string}`;
      if (repodata[item.repo_name].packages[`${packageName}.tar.bz2`]) {
        extention = '.tar.bz2';
      }
      const url = `${repoLinks[item.repo_name]}${packageName}${extention}`;
      solvedPackages[`${packageName}${extention}`] = {
        name: item.name,
        version: item.evr,
        url
      };
    });

    return solvedPackages;
  };

  return {
    solve
  };
};

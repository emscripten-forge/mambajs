import initializeWasm from './core-wasm';
import { parse } from 'yaml';

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

export interface ILogger {
  readonly element: HTMLDivElement;
  log(...msg: any[]): void;
  warn(...msg: any[]): void;
  error(...msg: any[]): void;
}

export const initEnv = async (
  logger?: ILogger,
  locateWasm?: (file: string) => string
) => {
  if (logger) {
    logger.log('Loading solver ...');
  }
  const wasmModule = await initializeWasm(locateWasm);
  const instance = new wasmModule.PicoMambaCore();

  const getLinks = (channels: Array<string>) =>{
    const defaultUrl = {
      'conda-forge': "https://conda.anaconda.org/conda-forge"
    }
    const platforms = {'noarch': 'noarch', 'emscripten-wasm32': 'arch'};
    let links:Array<IRepoDataLink> = [];
    channels.forEach((channel) =>{
      let link = '';
      let channelUrl = channel;
      if (defaultUrl[channel]) {
        channelUrl = defaultUrl[channel];
      }
      Object.keys(platforms).forEach((platform)=>{
        link = `${channelUrl}/${platform}/repodata.json`;
        let repo = platforms[platform];
        let tmp:IRepoDataLink = {};
        tmp[repo] = link;
        links.push(tmp);
      });
    });
    return links;
  }

  const solve = async (envYml: string) => {
    const startSolveTime = performance.now();
    let result: any = undefined;
    const data = parse(envYml);
    const prefix = data.name ? data.name : '/';
    const packages = data?.dependencies ? data.dependencies : [];
    const channels = data?.channels ? data.channels : [];
    let links = getLinks(channels);
    console.log('links', links);
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
    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }

    return result;
  };

  const getRepodata = async (
    repodataUrls: Array<IRepoDataLink>
  ): Promise<Repodata> => {
    const repodataTotal: Repodata = {};
    await Promise.all(
      repodataUrls.map(async item => {
        const repoName = Object.keys(item)[0];
        if (logger) {
          logger.log('Downloading repodata', repoName, '...');
        }
        const url = item[repoName];
        console.log('url', url);
        if (url) {
          const data = await fetchRepodata(url);
          if (data) {
            repodataTotal[repoName] = data;
          }
        }
      })
    );

    return repodataTotal;
  };

  const fetchRepodata = async (url: string): Promise<Uint8Array| null> => {
    const options = {
      headers: { 'Accept-Encoding': 'zstd' }
    };

    const response = await fetch(url, options);
    console.log('response', response);
    if (!response.ok) {
      return null;
    }

    return new Uint8Array(await response.arrayBuffer());
  };

  const loadRepodata = (repodata: Repodata): void => {
    Object.keys(repodata).map(repoName => {
      if (logger) {
        logger.log(`Load repodata ${repoName} ...`);
      }
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
    if (logger) {
      logger.log('Solving environment ...');
    }
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

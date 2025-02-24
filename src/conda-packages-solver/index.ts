import { ILogger, ISolvedPackages } from '../helper';
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

export const initEnv = async (
  logger?: ILogger,
  locateWasm?: (file: string) => string
) => {
  if (logger) {
    logger.log('Loading solver ...');
  }
  const wasmModule = await initializeWasm(locateWasm);
  const instance = new wasmModule.PicoMambaCore();

  const getDefaultChannels = () => {
    let channels = [
      'https://repo.prefix.dev/conda-forge',
      'https://repo.prefix.dev/emscripten-forge-dev'
    ];
    return channels;
  };

  const getLinks = (channels?: Array<string>) => {
    const channelsAlias = {
      'conda-forge': 'https://conda.anaconda.org/conda-forge'
    };
    const platforms = { noarch: 'noarch', 'emscripten-wasm32': 'arch' };
    let links: Array<IRepoDataLink> = [];
    let repoLinks: IRepoDataLink = {};
    let repoIndex = 0;
    if ((channels && !channels.length) || !channels) {
      channels = [...getDefaultChannels()];
    }
    if (channels.includes('defaults')) {
      let filteredChannels = channels.filter(channel => {
        if (channel !== 'defaults') {
          return channel;
        }
      });
      channels = [...filteredChannels, ...getDefaultChannels()];
    }

    channels.forEach(channel => {
      let link = '';
      let channelUrl = channel;
      if (channelsAlias[channel]) {
        channelUrl = channelsAlias[channel];
      }

      if (channelUrl.includes('https') || channelUrl.includes('http')) {
        Object.keys(platforms).forEach(platform => {
          link = `${channelUrl}/${platform}/repodata.json`;
          let repo = `${platforms[platform]}-${repoIndex}`;
          repoLinks[repo] = `${channelUrl}/${platform}/`;
          let tmp: IRepoDataLink = {};
          tmp[repo] = link;
          links.push(tmp);
        });
        repoIndex += 1;
      }
    });
    return { links, repoLinks };
  };

  const solve = async (envYml: string) => {
    const startSolveTime = performance.now();
    const { prefix, specs, channels } = parseEnvYml(envYml);
    let result = solvePackages(specs, prefix, channels);
    const endSolveTime = performance.now();
    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }
    return result;
  };

  const solvePackages = async (
    specs: string[],
    prefix: string,
    channels?: string[]
  ) => {
    let { links, repoLinks } = getLinks(channels);
    let result: any = undefined;
    let repodata = await getRepodata(links);

    if (Object.keys(repodata)) {
      loadRepodata(repodata);
      result = getSolvedPackages(specs, prefix, repoLinks);
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
        if (url) {
          const data = await fetchRepodata(url, logger);
          if (data) {
            repodataTotal[repoName] = data;
          }
        }
      })
    );

    return repodataTotal;
  };

  const fetchRepodata = async (
    url: string,
    logger?: ILogger
  ): Promise<Uint8Array | null> => {
    const options = {
      headers: { 'Accept-Encoding': 'zstd' }
    };

    const response = await fetch(url, options);
    if (!response.ok) {
      if (logger) {
        logger.warn(`Failed to fetch ${url}`);
      }
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
    repoLinks: IRepoDataLink
  ) => {
    if (logger) {
      logger.log('Solving environment ...');
    }
    if (!wasmModule.FS.analyzePath(prefix).exists) {
      wasmModule.FS.mkdir(prefix);
      wasmModule.FS.mkdir(`${prefix}/conda-meta`);
      wasmModule.FS.mkdir(`${prefix}/arch`);
      wasmModule.FS.mkdir(`${prefix}/noarch`);
    } else {
      registerInstalledPackages(prefix);
    }

    const config = new wasmModule.PicoMambaCoreSolveConfig();

    const packageListVector = new wasmModule.PackageList();
    packages.forEach((item: string) => {
      packageListVector.push_back(item);
    });

    const rawTransaction = instance.solve(packageListVector, config);
    packageListVector.delete();
    return transform(rawTransaction, repoLinks);
  };

  const transform = (rawTransaction: any, repoLinks: IRepoDataLink) => {
    const rawInstall = rawTransaction.install;
    const solvedPackages: ISolvedPackages = {};

    rawInstall.forEach((item: ITransactionItem) => {
      solvedPackages[item.filename] = {
        name: item.name,
        version: item.evr,
        build_string: item.build_string,
        repo_name: item.repo_name,
        repo_url: repoLinks[item.repo_name],
        url: `${repoLinks[item.repo_name]}${item.filename}`
      };
    });

    return solvedPackages;
  };

  const install = async (
    specs: string[],
    prefix: string,
    channels?: string[]
  ) => {
    return solvePackages(specs, prefix, channels);
  };

  const parseEnvYml = (envYml: string) => {
    const data = parse(envYml);
    const packages = data.dependencies ? data.dependencies : [];
    const prefix = data.name ? data.name : '/';
    const channels = data.channels ? data.channels : [];

    const specs: string[] = [];
    // Remove pip dependencies which do not impact solving
    for (const pkg of packages) {
      if (typeof pkg === 'string') {
        specs.push(pkg);
      }
    }
    return { prefix, specs, channels };
  };

  const registerInstalledPackages = (prefix: string, logger?: ILogger) => {
    if (logger) {
      logger.log(`Loading installed packages, prefix: ${prefix}`);
    }
    instance.loadInstalled(prefix);
  };

  return {
    solve,
    install
  };
};

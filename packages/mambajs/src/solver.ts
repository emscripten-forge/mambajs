import {
  ILogger,
  ISolvedPackages,
  splitPipPackages
} from '@emscripten-forge/mambajs-core';
import { parse } from 'yaml';
import { Platform, simpleSolve, SolvedPackage } from '@conda-org/rattler';

const PLATFORMS: Platform[] = ['noarch', 'emscripten-wasm32'];
const DEFAULT_CHANNELS = [
  'https://repo.prefix.dev/emscripten-forge-dev',
  'https://repo.prefix.dev/conda-forge'
];
const ALIAS = ['conda-forge', 'emscripten-forge-dev'];
const CHANNEL_ALIASES = {
  'emscripten-forge-dev': 'https://repo.prefix.dev/emscripten-forge-dev',
  'conda-forge': 'https://repo.prefix.dev/conda-forge'
};

const parseEnvYml = (envYml: string) => {
  const data = parse(envYml);
  const packages = data.dependencies ? data.dependencies : [];
  const prefix = data.name ? data.name : '/';
  const channels: Array<string> = data.channels ? data.channels : [];

  const specs: string[] = [];
  for (const pkg of packages) {
    if (typeof pkg === 'string') {
      specs.push(pkg);
    }
  }
  return { prefix, specs, channels };
};

export interface ISolveOptions {
  ymlOrSpecs?: string | string[];
  installedPackages?: ISolvedPackages;
  pipSpecs?: string[];
  channels?: string[];
  logger?: ILogger;
}

const solve = async (
  specs: Array<string>,
  channels: Array<string>,
  installedCondaPackages: ISolvedPackages,
  logger?: ILogger
) => {
  let result: SolvedPackage[] | undefined = undefined;
  const solvedPackages: ISolvedPackages = {};
  try {
    let installed: any = [];
    if (Object.keys(installedCondaPackages).length) {
      Object.keys(installedCondaPackages).map((filename: string) => {
        const installedPkg = installedCondaPackages[filename];
        let tmpPkg = {
          ...installedPkg,
          packageName: installedPkg.name,
          build: installedPkg.build_string,
          filename
        };

        installed.push(tmpPkg);
      });
    } else {
      installed = undefined;
    }
    const startSolveTime = performance.now();
    result = (await simpleSolve(
      specs,
      channels,
      PLATFORMS,
      installed
    )) as SolvedPackage[];
    const endSolveTime = performance.now();
    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }
    result.forEach((pkg: any) => {
      const installedPkg = installedCondaPackages[pkg.filename];
      if (installedPkg) {
        logger?.log(`${installedPkg.name} has been already installed`);
      }
    });
    result.map((item: any) => {
      const {
        filename,
        packageName,
        repoName,
        url,
        version,
        build,
        buildNumber,
        depends,
        subdir
      } = item;
      solvedPackages[filename] = {
        name: packageName,
        repo_url: repoName,
        build_string: build,
        url: url,
        version: version,
        repo_name: repoName,
        build_number: buildNumber,
        depends,
        subdir
      };
    });
  } catch (error) {
    logger?.error(error);
    throw new Error(error as string);
  }

  return solvedPackages;
};

export const getSolvedPackages = async (
  options: ISolveOptions
): Promise<ISolvedPackages> => {
  const { ymlOrSpecs, installedPackages, channels, logger } = options;
  let solvedPackages: ISolvedPackages = {};

  let specs: string[] = [],
    newChannels: string[] = [];
  let installedCondaPackages: ISolvedPackages = {};

  if (typeof ymlOrSpecs === 'string') {
    const ymlData = parseEnvYml(ymlOrSpecs);
    specs = ymlData.specs;
    newChannels = formatChannels(ymlData.channels);
  } else {
    const pkgs = splitPipPackages(installedPackages);
    installedCondaPackages = pkgs.installedCondaPackages;

    specs = ymlOrSpecs as string[];
    newChannels = formatChannels(channels);
  }

  if (logger) {
    logger.log('Solving environment...');
  }

  try {
    solvedPackages = await solve(
      specs,
      newChannels,
      installedCondaPackages,
      logger
    );
  } catch (error: any) {
    throw new Error(error.message);
  }
  return solvedPackages;
};

const getChannelsAlias = (channelNames: string[]) => {
  const channels = channelNames.map((channel: string) => {
    if (CHANNEL_ALIASES[channel]) {
      channel = CHANNEL_ALIASES[channel];
    }
    return channel;
  });

  return channels;
};

const formatChannels = (channels?: string[]) => {
  if (!channels || !channels.length) {
    channels = [...DEFAULT_CHANNELS];
  } else {
    channels = Array.from(new Set([...channels, ...DEFAULT_CHANNELS]));
  }
  let hasAlias = false;
  let hasDefault = false;
  const aliasChannelsNames: string[] = [];

  const filteredChannels = new Set<string>();
  channels.forEach((channel: string) => {
    if (ALIAS.includes(channel)) {
      hasAlias = true;
      aliasChannelsNames.push(channel);
    }

    if (channel === 'defaults') {
      hasDefault = true;
    }

    if (channel !== 'defaults' && !ALIAS.includes(channel) && channel) {
      filteredChannels.add(normalizeUrl(channel));
    }
  });

  channels = [...filteredChannels];
  if (hasDefault) {
    channels = Array.from(new Set([...channels, ...DEFAULT_CHANNELS]));
  }
  if (hasAlias) {
    channels = Array.from(
      new Set([...channels, ...getChannelsAlias(aliasChannelsNames)])
    );
  }

  return channels;
};

const normalizeUrl = (url: string) => {
  return url.replace(/[\/\s]+$/, '');
};

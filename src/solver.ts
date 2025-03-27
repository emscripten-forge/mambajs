import {
  ILogger,
  ISolvedPackages,
  ISolveOptions,
  splitPipPackages
} from './helper';
import { parse } from 'yaml';
import { Platform, simpleSolve } from '@baszalmstra/rattler';

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

const solve = async (
  specs: Array<string>,
  channels: Array<string>,
  logger?: ILogger
) => {
  let result: any = undefined;
  const solvedPackages: ISolvedPackages = {};
  try {
    const startSolveTime = performance.now();
    result = await simpleSolve(specs, channels, PLATFORMS);
    const endSolveTime = performance.now();

    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }

    result.map((item: any) => {
      const { filename, packageName, repoName, url, version, build } = item;
      solvedPackages[filename] = {
        name: packageName,
        repo_url: repoName,
        build_string: build,
        url: url,
        version: version,
        repo_name: repoName
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
  if (logger) {
    logger.log('Loading solver ...');
  }
  let solvedPackages: ISolvedPackages = {};

  let specs: string[] = [],
    newChannels: string[] = [];

  if (typeof ymlOrSpecs === 'string') {
    if (logger) {
      logger.log('Solving environment...');
    }
    const ymlData = parseEnvYml(ymlOrSpecs);
    specs = ymlData.specs;
    newChannels = formatChannels(ymlData.channels);
  } else {
    if (logger) {
      logger.log('Solving packages for installing them...');
    }
    const { installedCondaPackages } = splitPipPackages(installedPackages);
    const data = prepareForInstalling(
      installedCondaPackages,
      ymlOrSpecs as string[],
      channels
    );
    specs = data.specs;
    newChannels = data.channels;
  }
  try {
    solvedPackages = await solve(specs, newChannels, logger);
  } catch (error: any) {
    throw new Error(error.message);
  }
  return solvedPackages;
};

export const prepareForInstalling = (
  condaPackages: ISolvedPackages,
  specs: Array<string>,
  channelNames: Array<string> = []
) => {
  const channelsUrl: Set<string> = new Set();
  let channels: string[] = [];

  Object.keys(condaPackages).map((filename: string) => {
    const installedPackage = condaPackages[filename];
    if (installedPackage.repo_url) {
      channelsUrl.add(installedPackage.repo_url);
    }
    specs.push(`${installedPackage.name}`);
  });

  channels = Array.from(new Set([...channelsUrl, ...channelNames]));
  channels = formatChannels(channels);
  return { specs, channels };
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

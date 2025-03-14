import {
  filterPackages,
  hasYml,
  ILogger,
  ISolvedPackages,
  ISolveOptions
} from './helper';
import { parse } from 'yaml';
import { simpleSolve, Platform } from '@baszalmstra/rattler';

const platforms: Platform[] = ['noarch', 'emscripten-wasm32'];

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
  platforms: Platform[],
  logger?: ILogger
) => {
  let result: any = undefined;
  let solvedPackages: ISolvedPackages = {};
  try {
    const startSolveTime = performance.now();
    result = await simpleSolve(specs, channels, platforms);
    const endSolveTime = performance.now();

    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }

    result.map((item: any) => {
      const {
        buildNumber,
        filename,
        packageName,
        repoName,
        url,
        version,
        build
      } = item;
      solvedPackages[filename] = {
        name: packageName,
        repo_url: repoName,
        build_number: buildNumber,
        build_string: build,
        url: url,
        version: version,
        repo_name: repoName
      };
    });
  } catch (error) {
    logger?.error(error);
  }

  return solvedPackages;
};

const getDefaultChannels = () => {
  let channels = [
    'https://repo.prefix.dev/emscripten-forge-dev',
    'https://repo.prefix.dev/conda-forge'
  ];
  return channels;
};

export const getSolvedPackages = async (options: ISolveOptions) => {
  let { ymlOrSpecs, installedPackages, channels, logger } = options;
  if (logger) {
    logger.log('Loading solver ...');
  }
  let solvedPackages: ISolvedPackages = {};

  let specs: string[] = [],
    newChannels: string[] = [];
  const isYml = hasYml(ymlOrSpecs);
  if (isYml) {
    if (logger) {
      logger.log('Solving initial packages...');
    }
    console.log('ymlOrSpecs', ymlOrSpecs);
    const ymlData = parseEnvYml(ymlOrSpecs as string);
    specs = ymlData.specs;
    newChannels = formatChannels(ymlData.channels, logger);
  } else {
    if (logger) {
      logger.log('Solving packages for installing them...');
    }
    let { installedCondaPackages } = filterPackages(installedPackages);
    console.log('installedCondaPackages', installedCondaPackages);
    console.log('prepareForInstalling');
    const data = prepareForInstalling(
      installedCondaPackages,
      ymlOrSpecs as string[],
      channels,
      logger
    );
    specs = data.specs;
    newChannels = data.channels;
  }
  console.log('Installing');
  console.log('newChannels', newChannels);
  console.log('specs', specs);
  console.log('platforms', platforms);
  solvedPackages = await solve(specs, newChannels, platforms, logger);
  return solvedPackages;
};

export const prepareForInstalling = (
  condaPackages: ISolvedPackages,
  specs: Array<string>,
  channelNames: Array<string> = [],
  logger?: ILogger
) => {
  let channelsDict = {};
  let channels: Array<string> = [];

  Object.keys(condaPackages).map((filename: string) => {
    let installedPackage = condaPackages[filename];
    if (installedPackage.repo_url) {
      channelsDict[installedPackage.repo_url] = installedPackage.repo_url;
    }
    specs.push(`${installedPackage.name}=${installedPackage.version}`);
  });

  channels = Object.keys(channelsDict);

  if (!channels.length) {
    logger?.error('There is no any channels of installed packages');
  }

  if (!channelNames || !channelNames.length) {
    logger?.error('There is no channel for a new package');
  }

  channels = Array.from(new Set([...channels, ...channelNames]));
  channels = formatChannels(channels, logger);
  console.log('channels', channels);
  console.log('specs', specs);
  return { specs, channels };
};

const getChannelsAlias = (channelNames: string[]) => {
  let channelAlias = {
    'conda-forge': 'https://repo.prefix.dev/conda-forge',
    'emscripten-forge-dev': 'https://repo.prefix.dev/emscripten-forge-dev'
  };

  let channels = channelNames.map((channel: string) => {
    if (channelAlias[channel]) {
      channel = channelAlias[channel];
    }
    return channel;
  });
  return channels;
};

const formatChannels = (channels?: string[], logger?: ILogger) => {
  let alias = ['conda-forge', 'emscripten-forge-dev'];
  if (!channels || !channels.length) {
    logger?.log('There is no channels, default channels will be taken');
    channels = [...getDefaultChannels()];
  }
  let hasAlias = false;
  let hasDefault = false;
  let aliasChannelsNames: string[] = [];

  let filteredChannels = channels.filter(channel => {
    if (alias.includes(channel)) {
      hasAlias = true;
      aliasChannelsNames.push(channel);
    }

    if (channel === 'defaults') {
      hasDefault = true;
    }

    if (channel !== 'defaults' && !alias.includes(channel)) {
      return channel;
    }
  });
  console.log('filteredChannels', filteredChannels);
  if (hasDefault) {
    console.log('There is a default channel from the channel list');
    logger?.log('There is a default channel from the channel list');
    channels = Array.from(
      new Set([
        ...filteredChannels.map(normalizeUrl),
        ...getDefaultChannels().map(normalizeUrl)
      ])
    );
  }
  if (hasAlias) {
    console.log('There are channel alias');
    logger?.log('There are channel alias');
    channels = Array.from(
      new Set([
        ...getChannelsAlias(aliasChannelsNames).map(normalizeUrl),
        ...filteredChannels.map(normalizeUrl)
      ])
    );
  }
  console.log('Result channels', channels);
  return channels;
};

const normalizeUrl = (url: string) => {
  return url.replace(/\/$/, '');
};

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
    const ymlData = parseEnvYml(ymlOrSpecs as string);
    specs = ymlData.specs;
    newChannels = ymlData.channels;
  } else {
    if (logger) {
      logger.log('Solving packages for installing them...');
    }
    let { installedCondaPackages } = filterPackages(installedPackages);
    const data = prepareForInstalling(
      installedCondaPackages,
      ymlOrSpecs as string[],
      channels,
      logger
    );
    specs = data.specs;
    newChannels = data.channels;
  }
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
  if (!channels.length && (!channelNames || !channelNames.length)) {
    logger?.log('Using default channels');
    channels = getDefaultChannels();
  }

  let channelAlias = {
    'conda-forge': 'https://repo.prefix.dev/conda-forge',
    'emscripten-forge-dev': 'https://repo.prefix.dev/emscripten-forge-dev'
  };

  let newChannels = channelNames.map((channel: string) => {
    if (channelAlias[channel]) {
      channel = channelAlias[channel];
    }
    return channel;
  });
  console.log('channels', channels);
  console.log('newChannels', newChannels);
  console.log('specs', specs);

  channels = [...channels, ...newChannels];
  return { specs, channels };
};

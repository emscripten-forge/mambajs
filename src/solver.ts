import { ILogger, ISolvedPackages } from './helper';
import { parse } from 'yaml';
import { simple_solve } from '@baszalmstra/rattler';

const platforms = ['noarch', 'emscripten-wasm32'];

const parseEnvYml = (envYml: string) => {
  const data = parse(envYml);
  const packages = data.dependencies ? data.dependencies : [];
  const prefix = data.name ? data.name : '/';
  const channels = data.channels ? data.channels : [];

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
  platforms: Array<string>,
  logger?: ILogger
) => {
  let result: any = undefined;
  let solvedPackages: ISolvedPackages = {};
  try {
    const startSolveTime = performance.now();
    result = await simple_solve(specs, channels, platforms);
    const endSolveTime = performance.now();

    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }

    result.map((item: any) => {
      const { build_number, filename, package_name, repo_name, url, version } =
        item;
      solvedPackages[filename] = {
        name: package_name,
        repo_url: repo_name,
        build_number: build_number,
        url: url,
        version: version,
        repo_name: repo_name
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

export const getSolvedPackages = async (envYml: string, logger?: ILogger) => {
  if (logger) {
    logger.log('Loading solver ...');
  }
  let solvedPackages: ISolvedPackages = {};
  const { specs, channels } = parseEnvYml(envYml);
  solvedPackages = await solve(specs, channels, platforms, logger);
  return solvedPackages;
};

export const solvePackage = async (
  installedPackages: ISolvedPackages,
  packageName: string,
  channelName: string,
  packageVersion?: string,
  logger?: ILogger
) => {
  let channelsDict = {};
  let channels: Array<string> = [];
  let specs: Array<string> = [];
  let solvedPackages: ISolvedPackages = {};
  Object.keys(installedPackages).map((filename: string) => {
    let installedPackage = installedPackages[filename];
    if (installedPackage.repo_url) {
      channelsDict[installedPackage.repo_url] = installedPackage.repo_url;
      channels = Object.keys(channelsDict);
    }
    if (!channels.length) {
      logger?.error('There is no any channels of installed packages');
    }
    if (!channelName) {
      logger?.error('There is no channel for a new package');
    }
    if (!channels.length && !channelName) {
      logger?.log('Using default channels');
      channels = getDefaultChannels();
    }
    specs.push(`${installedPackage.name}=${installedPackage.version}`);
  });
  specs.push(`${packageName}${packageVersion}`);
  logger?.log('Solving a new package with previous installed ones');
  solvedPackages = await solve(specs, channels, platforms, logger);
  return solvedPackages;
};

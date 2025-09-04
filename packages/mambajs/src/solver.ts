import {
  ALIASES,
  ILock,
  ILogger,
  ISolvedPackages,
  parseEnvYml,
  splitPipPackages
} from '@emscripten-forge/mambajs-core';
import { Platform, simpleSolve, SolvedPackage } from '@conda-org/rattler';

export interface ISolveOptions {
  ymlOrSpecs?: string | string[];
  installedPackages?: ISolvedPackages;
  pipSpecs?: string[];
  channels?: string[];
  platform?: Platform;
  logger?: ILogger;
}

const solve = async (
  specs: Array<string>,
  channels: Array<string>,
  installedCondaPackages: ISolvedPackages,
  platform: Platform = 'emscripten-wasm32',
  logger?: ILogger
) => {
  let result: SolvedPackage[] | undefined = undefined;
  const solvedPackages: ISolvedPackages = {};
  try {
    let installed: any = [];
    if (Object.keys(installedCondaPackages).length) {
      Object.keys(installedCondaPackages).map((filename: string) => {
        const installedPkg = installedCondaPackages[filename];
        if (installedPkg.url) {
          const tmpPkg = {
            ...installedPkg,
            packageName: installedPkg.name,
            repoName: installedPkg.repo_name,
            build: installedPkg.build_string,
            buildNumber: installedPkg.build_number
              ? BigInt(installedPkg.build_number)
              : undefined,
            filename
          };

          installed.push(tmpPkg);
        }
      });
    } else {
      installed = undefined;
    }

    const startSolveTime = performance.now();
    result = (await simpleSolve(
      specs,
      channels,
      ['noarch', platform],
      installed
    )) as SolvedPackage[];
    const endSolveTime = performance.now();
    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }

    result.map(item => {
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
        build_number:
          buildNumber && buildNumber <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(buildNumber)
            : undefined,
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

export const solveConda = async (
  options: ISolveOptions
): Promise<ILock> => {
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
    newChannels = formatChannels(channels);
    specs = ymlOrSpecs as string[];
  }

  if (logger) {
    logger.log('Solving environment...');
  }

  try {
    solvedPackages = await solve(
      specs,
      newChannels,
      installedCondaPackages,
      options.platform ?? 'emscripten-wasm32',
      logger
    );
  } catch (error: any) {
    throw new Error(error.message);
  }

  return {

  };
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

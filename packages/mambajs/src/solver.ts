import {
  cleanUrl,
  DEFAULT_PLATFORM,
  formatChannels,
  ILock,
  ILogger,
  ISolvedPackages,
  ISolvedPipPackages,
  parseEnvYml
} from '@emscripten-forge/mambajs-core';
import { Platform, simpleSolve, SolvedPackage } from '@conda-org/rattler';

export interface ISolveOptions {
  ymlOrSpecs?: string | string[];
  installedPackages?: {
    packages: ISolvedPackages;
    pipPackages: ISolvedPipPackages;
  };
  pipSpecs?: string[];
  channels?: string[];
  platform?: Platform;
  logger?: ILogger;
}

// TODO GET RID OF THIS STUPID WRAPPER
const solve = async (
  specs: Array<string>,
  channels: Array<string>,
  installedCondaPackages: ISolvedPackages,
  platform: Platform = DEFAULT_PLATFORM,
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
      // TODO WAT THE F
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

export const solveConda = async (options: ISolveOptions): Promise<ILock> => {
  const { ymlOrSpecs, installedPackages, channels, logger } = options;
  let condaPackages: ISolvedPackages = {};

  let specs: string[] = [],
    formattedChannels: Pick<ILock, 'channels' | 'channel_priority'> = {
      channel_priority: [],
      channels: {}
    };
  let installedCondaPackages: ISolvedPackages = {};

  if (typeof ymlOrSpecs === 'string') {
    const ymlData = parseEnvYml(ymlOrSpecs);
    specs = ymlData.specs;
    formattedChannels = formatChannels(ymlData.channels);
  } else {
    const pkgs = splitPipPackages(installedPackages);
    installedCondaPackages = pkgs.installedCondaPackages;
    formattedChannels = formatChannels(channels);
    specs = ymlOrSpecs as string[];
  }

  if (logger) {
    logger.log('Solving environment...');
  }

  try {
    condaPackages = await solve(
      specs,
      formattedChannels.channel_priority.map(channelName => {
        // TODO Support picking mirror
        // Always picking the first mirror for now
        return formattedChannels.channels[channelName][0].url;
      }),
      installedCondaPackages,
      options.platform ?? 'emscripten-wasm32',
      logger
    );
  } catch (error: any) {
    throw new Error(error.message);
  }

  // Turn the rattler result into what the lock expects
  const packages: ILock['packages'] = {};
  Object.keys(condaPackages).forEach(filename => {
    const pkg = condaPackages[filename];

    let channel = '';
    if (
      pkg.repo_name &&
      formattedChannels.channel_priority.includes(pkg.repo_name)
    ) {
      channel = pkg.repo_name;
    }
    if (
      pkg.repo_url &&
      formattedChannels.channel_priority.includes(cleanUrl(pkg.repo_url))
    ) {
      channel = pkg.repo_url;
    }

    if (!channel) {
      throw new Error(
        `Failed to detect channel from ${pkg}, with know channels ${formattedChannels.channel_priority}`
      );
    }

    packages[filename] = {
      name: pkg.name,
      build_number: pkg.build_number,
      build_string: pkg.build_string,
      version: pkg.version,
      subdir: pkg.subdir,
      channel
    };
  });

  return {
    'lock.version': '1.0.0',
    platform: options.platform as ILock['platform'],
    specs,
    channels: formattedChannels.channels,
    channel_priority: formattedChannels.channel_priority,
    packages,
    pipPackages: {}
  };
};

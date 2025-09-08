import {
  DEFAULT_PLATFORM,
  formatChannels,
  ILock,
  ILogger,
  ISolvedPackages,
  parseEnvYml
} from '@emscripten-forge/mambajs-core';
import { Platform, simpleSolve, SolvedPackage } from '@conda-org/rattler';

export interface ISolveOptions {
  ymlOrSpecs?: string | string[];
  pipSpecs?: string[];
  platform?: Platform;
  currentLock?: ILock;
  logger?: ILogger;
}

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
        const tmpPkg = {
          ...installedPkg,
          packageName: installedPkg.name,
          repoName: installedPkg.channel,
          buildNumber: installedPkg.buildNumber
            ? BigInt(installedPkg.buildNumber)
            : undefined,
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
        version,
        build,
        buildNumber,
        subdir
      } = item;
      solvedPackages[filename] = {
        name: packageName,
        build: build,
        version: version,
        channel: repoName ?? '',
        buildNumber:
          buildNumber && buildNumber <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(buildNumber)
            : undefined,
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
  const { ymlOrSpecs, currentLock, logger } = options;
  let condaPackages: ISolvedPackages = {};

  let specs: string[] = [],
    formattedChannels: Pick<ILock, 'channels' | 'channelPriority'> = {
      channelPriority: [],
      channels: {}
    };
  let installedCondaPackages: ISolvedPackages = {};

  // It's an environment creation from environment definition, currentLock is not a thing
  if (typeof ymlOrSpecs === 'string') {
    const ymlData = parseEnvYml(ymlOrSpecs);
    specs = ymlData.specs;
    formattedChannels = formatChannels(ymlData.channels);
  } else {
    installedCondaPackages = currentLock?.packages ?? {};
    formattedChannels = currentLock!;
    specs = ymlOrSpecs as string[];
  }

  if (logger) {
    logger.log('Solving environment...');
  }

  try {
    condaPackages = await solve(
      specs,
      formattedChannels.channelPriority.map(channelName => {
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
      pkg.channel &&
      formattedChannels.channelPriority.includes(pkg.channel)
    ) {
      channel = pkg.channel;
    }

    if (!channel) {
      throw new Error(
        `Failed to detect channel from ${pkg}, with known channels ${formattedChannels.channelPriority}`
      );
    }

    packages[filename] = {
      name: pkg.name,
      buildNumber: pkg.buildNumber,
      build: pkg.build,
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
    channelPriority: formattedChannels.channelPriority,
    packages,
    pipPackages: {}
  };
};

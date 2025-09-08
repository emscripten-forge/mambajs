import {
  cleanUrl,
  computePackageUrl,
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

export const solveConda = async (options: ISolveOptions): Promise<ILock> => {
  const { ymlOrSpecs, currentLock, logger } = options;
  const platform = options.platform ?? DEFAULT_PLATFORM;

  const condaPackages: ISolvedPackages = {};

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
    const startSolveTime = performance.now();

    const result = (await simpleSolve(
      specs,
      formattedChannels.channelPriority.map(channelName => {
        // TODO Support picking mirror
        // Always picking the first mirror for now
        return formattedChannels.channels[channelName][0].url;
      }),
      ['noarch', platform],
      Object.keys(installedCondaPackages).map((filename: string) => {
        // Turn mambajs lock definition into what rattler expects
        const installedPkg = installedCondaPackages[filename];
        return {
          ...installedPkg,
          packageName: installedPkg.name,
          repoName: installedPkg.channel,
          buildNumber: installedPkg.buildNumber
            ? BigInt(installedPkg.buildNumber)
            : undefined,
          filename,
          url: computePackageUrl(
            installedPkg,
            filename,
            formattedChannels.channels
          )
        };
      })
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
      condaPackages[filename] = {
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
  } catch (error: any) {
    logger?.error(error);
    throw new Error(error.message);
  }

  // Turn the rattler result into what the lock expects
  const packages: ILock['packages'] = {};
  Object.keys(condaPackages).forEach(filename => {
    const pkg = condaPackages[filename];

    let channel = '';
    if (
      pkg.channel &&
      formattedChannels.channelPriority.includes(cleanUrl(pkg.channel))
    ) {
      channel = cleanUrl(pkg.channel);
    }

    if (!channel) {
      throw new Error(
        `Failed to detect channel from ${pkg} (${pkg.channel}), with known channels ${formattedChannels.channelPriority}`
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

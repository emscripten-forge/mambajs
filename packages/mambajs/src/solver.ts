import {
  computePackageChannel,
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
  nRetries?: number;
}

export const solveConda = async (options: ISolveOptions): Promise<ILock> => {
  const { ymlOrSpecs, currentLock, logger } = options;
  const platform = options.platform ?? DEFAULT_PLATFORM;
  const nRetries = options.nRetries ?? 3;

  const condaPackages: ISolvedPackages = {};

  let specs: string[] = [],
    formattedChannels: Pick<ILock, 'channels' | 'channelInfo'> = {
      channels: [],
      channelInfo: {}
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
      formattedChannels.channels.map(channelName => {
        // TODO Support picking mirror
        // Always picking the first mirror for now
        return formattedChannels.channelInfo[channelName][0].url;
      }),
      ['noarch', platform],
      Object.keys(installedCondaPackages).map((filename: string) => {
        // Turn mambajs lock definition into what rattler expects
        const installedPkg = installedCondaPackages[filename];
        return {
          filename,
          packageName: installedPkg.name,
          repoName: installedPkg.channel,
          version: installedPkg.version,
          build: installedPkg.build,
          subdir: installedPkg.subdir,
          md5: installedPkg.hash?.md5,
          sha256: installedPkg.hash?.sha256,
          url: computePackageUrl(
            installedPkg,
            filename,
            formattedChannels.channelInfo
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
        subdir,
        md5,
        sha256
      } = item;

      const hash: ILock['packages'][string]['hash'] = {};
      if (md5) hash.md5 = md5;
      if (sha256) hash.sha256 = sha256;

      condaPackages[filename] = {
        name: packageName,
        build: build,
        version: version,
        channel: repoName ?? '',
        subdir
      };

      if (item.size) condaPackages[filename].size = Number(item.size);

      if (Object.keys(hash).length) {
        condaPackages[filename].hash = hash;
      }
    });
  } catch (error) {
    let message: string = 'Unknown error';
    if (typeof error === 'string') {
      message = error;
    } else if (error instanceof Error) {
      message = error.message;
    }

    // Retry 3 times on flaky request error
    if (message.includes('error sending request')) {
      if (nRetries !== 0) {
        logger?.warn(message);
        return solveConda({ ...options, nRetries: nRetries - 1 });
      }
    }

    logger?.error(message);
    throw new Error(message);
  }

  // Turn the rattler result into what the lock expects
  const packages: ILock['packages'] = {};
  Object.keys(condaPackages).forEach(filename => {
    const pkg = condaPackages[filename];

    const channel = computePackageChannel(pkg, formattedChannels);

    if (!channel) {
      throw new Error(
        `Failed to detect channel from ${pkg} (${pkg.channel}), with known channels ${formattedChannels.channels}`
      );
    }

    packages[filename] = {
      name: pkg.name,
      build: pkg.build,
      version: pkg.version,
      subdir: pkg.subdir,
      channel
    };

    if (pkg.hash) {
      packages[filename].hash = pkg.hash;
    }
    if (pkg.size) {
      packages[filename].size = pkg.size;
    }
  });

  return {
    lockVersion: '1.0.3',
    platform,
    specs,
    channels: formattedChannels.channels,
    channelInfo: formattedChannels.channelInfo,
    packages,
    pipPackages: currentLock?.pipPackages ?? {}
  };
};

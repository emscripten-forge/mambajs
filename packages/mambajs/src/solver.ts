import {
  DEFAULT_CHANNEL_PRIORITY,
  DEFAULT_CHANNELS,
  DEFAULT_PLATFORM,
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
  let condaPackages: ISolvedPackages = {};

  let specs: string[] = [],
    formattedChannels: Pick<ILock, 'channels' | 'channel_priority'> = {
      'channel_priority': [],
      'channels': {},
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
      formattedChannels.channel_priority.map((channelName) => {
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
    if (pkg.repo_name && formattedChannels.channel_priority.includes(pkg.repo_name)) {
      channel = pkg.repo_name;
    }
    if (pkg.repo_url && formattedChannels.channel_priority.includes(cleanUrl(pkg.repo_url))) {
      channel = pkg.repo_url;
    }

    if (!channel) {
      throw new Error(`Failed to detect channel from ${pkg}, with know channels ${formattedChannels.channel_priority}`);
    }

    packages[filename] = {
      name: pkg.name,
      build_number: pkg.build_number,
      build_string: pkg.build_string,
      version: pkg.version,
      subdir: pkg.subdir,
      channel
    }
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

const formatChannels = (channels?: string[]): Pick<ILock, 'channels' | 'channel_priority'> => {
  if (!channels || !channels.length) {
    return {
      channels: DEFAULT_CHANNELS,
      channel_priority: DEFAULT_CHANNEL_PRIORITY
    };
  }

  const formattedChannels: Pick<ILock, 'channels' | 'channel_priority'> = {
    channels: {},
    channel_priority: []
  };

  // Returns the default channel name if it's a default one, otherwise null
  const getDefaultChannel = (urlOrName: string): {
    name: string,
    channel: ILock['channels'][keyof ILock['channels']]
  } | null => {
    // Check if it's a known channel alias
    if (DEFAULT_CHANNEL_PRIORITY.includes(urlOrName)) {
      return {
        name: urlOrName,
        channel: DEFAULT_CHANNELS[urlOrName]
      };
    }

    // If it's a url, check if it matches a default channel mirror
    Object.keys(DEFAULT_CHANNELS).forEach(name => {
      const mirrors = DEFAULT_CHANNELS[name];
      mirrors.forEach(mirror => {
        if (urlOrName === mirror.url) {
          return {
            name,
            channel: mirrors
          }
        }
      });
    });

    return null;
  }

  const pushChannel = (channel: string) => {
    // Cleanup trailing url slash
    channel = cleanUrl(channel);

    // If it's defaults, push all default channels
    if (channel === 'defaults') {
      DEFAULT_CHANNEL_PRIORITY.forEach(pushChannel);
      return;
    }

    // If it's one of the default channels and it's not included yet, add it
    const asDefaultChannel = getDefaultChannel(channel);
    if (asDefaultChannel && !formattedChannels.channel_priority.includes(asDefaultChannel.name)) {
      formattedChannels.channel_priority.push(asDefaultChannel.name);
      formattedChannels.channels[asDefaultChannel.name] = asDefaultChannel.channel;
      return;
    }

    // Otherwise, add it if it's not included yet
    if (!formattedChannels.channel_priority.includes(channel)) {
      formattedChannels.channel_priority.push(channel);
      formattedChannels.channels[channel] = [{url: channel, protocol: 'https'}];
      return;
    }
  }

  channels?.forEach(pushChannel);

  return formattedChannels;
}

function cleanUrl(url: string): string {
  return url.replace(/[\/\s]+$/, '');
}

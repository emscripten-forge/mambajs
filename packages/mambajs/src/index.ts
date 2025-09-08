import {
  formatChannels,
  getPythonVersion,
  ILock,
  ILogger,
  ISolvedPackages,
  packageNameFromSpec,
  showEnvironmentDiff,
  showPackagesList
} from '@emscripten-forge/mambajs-core';
import { ISolveOptions, solveConda } from './solver';
import { getPipPackageName, hasPipDependencies, solvePip } from './solverpip';

// For backward compat
export * from '@emscripten-forge/mambajs-core';

export async function solve(options: ISolveOptions): Promise<ILock> {
  const { logger, ymlOrSpecs, pipSpecs, currentLock } = options;
  const installedCondaPackages = currentLock?.packages ?? {};
  const installedPipPackages = currentLock?.pipPackages ?? {};

  let condaPackages: ISolvedPackages = installedCondaPackages;
  let newLock: ILock | undefined = currentLock;

  // Create a wheel -> package name lookup table
  const installedWheels: { [name: string]: string } = {};
  for (const wheelname of Object.keys(installedPipPackages)) {
    installedWheels[installedPipPackages[wheelname].name] = wheelname;
  }

  // Get installed Python version
  let pythonVersion = getPythonVersion(Object.values(condaPackages));

  // Run conda solver first
  if (ymlOrSpecs && ymlOrSpecs.length) {
    try {
      newLock = await solveConda(options);
      condaPackages = newLock.packages;
      pythonVersion = getPythonVersion(Object.values(condaPackages));

      // Remove pip packages if they are now coming from conda
      // Here we try our best given the possible mismatches between pip package names and conda names
      for (const condaPackage of Object.values(condaPackages)) {
        const pipName = await getPipPackageName(condaPackage.name);
        if (installedWheels[pipName]) {
          delete installedPipPackages[installedWheels[pipName]];
        }
        if (installedWheels[condaPackage.name]) {
          delete installedPipPackages[installedWheels[condaPackage.name]];
        }
      }

      if (!currentLock) {
        showPackagesList({ packages: condaPackages, pipPackages: {} }, logger);
      } else {
        showEnvironmentDiff(
          currentLock,
          { packages: condaPackages, pipPackages: {} },
          logger
        );
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  if (!newLock) {
    throw new Error('Failed to solve');
  }

  // Run pip install second
  if (
    (typeof ymlOrSpecs === 'string' && hasPipDependencies(ymlOrSpecs)) ||
    pipSpecs?.length
  ) {
    if (!pythonVersion) {
      const msg =
        'Cannot install pip dependencies without Python installed in the environment!';
      logger?.error(msg);
      throw msg;
    }

    if (typeof ymlOrSpecs === 'string' && hasPipDependencies(ymlOrSpecs)) {
      logger?.log('');
      logger?.log('Process pip requirements ...\n');

      newLock.pipPackages = await solvePip(
        ymlOrSpecs,
        condaPackages,
        installedWheels,
        installedPipPackages,
        [],
        logger
      );
    } else {
      logger?.log('Process pip requirements ...\n');
      newLock.pipPackages = await solvePip(
        '',
        condaPackages,
        installedWheels,
        installedPipPackages,
        pipSpecs,
        logger
      );
    }
  }

  return newLock;
}

/**
 * Create an environment from an environment.yml definition
 * @param yml the environment.yml file content
 * @param logger the logs handler
 * @returns the solved environment
 */
export async function create(yml: string, logger?: ILogger): Promise<ILock> {
  return await solve({ ymlOrSpecs: yml, logger });
}

/**
 * Install conda packages in an existing environment
 * @param specs the new specs
 * @param channels the channels to use
 * @param env the current environment lock
 * @param logger the logs handler
 * @returns the solved environment
 */
export async function install(
  specs: string[],
  env: ILock,
  channels?: string[],
  logger?: ILogger
): Promise<ILock> {
  // Merge existing channels with new ones
  const newChannels = formatChannels(channels);

  for (const channel of newChannels.channelPriority) {
    if (!env.channelPriority.includes(channel)) {
      env.channelPriority.push(channel);
      env.channels[channel] = newChannels.channels[channel];
    }
  }

  // Merge existing specs with new ones
  const newSpecs = Array.from(new Set([...env.specs, ...(specs || [])]));

  logger?.log(`Specs: ${newSpecs.join(', ')}`);
  logger?.log(`Channels: ${newChannels.channelPriority.join(', ')}`);
  logger?.log('');

  return await solve({
    ymlOrSpecs: newSpecs,
    currentLock: env,
    logger
  });
}

/**
 * Remove conda packages in an existing environment
 * @param packages the packages to remove
 * @param env the current environment
 * @param logger the logs handler
 * @returns the solved environment
 */
export async function remove(
  packages: string[],
  env: ILock,
  logger?: ILogger
): Promise<ILock> {
  // Get packages for which we have specs already
  const specsPackages = new Set(
    env.specs.map(spec => packageNameFromSpec(spec))
  );

  // Mapping: installed package name -> dist filename
  const installedPipPackagesNames: { [key: string]: string } = {};
  Object.keys(env.pipPackages).map(filename => {
    installedPipPackagesNames[env.pipPackages[filename].name] = filename;
  });
  const installedCondaPackagesNames: { [key: string]: string } = {};
  Object.keys(env.packages).map(filename => {
    installedCondaPackagesNames[env.packages[filename].name] = filename;
  });

  const toRemove = new Set(
    packages.filter(name => {
      let errorMsg = '';

      // If it's a sub-dependency
      if (installedCondaPackagesNames[name] && !specsPackages.has(name)) {
        errorMsg = `Failure: ${name} is a dependency of another installed package, cannot remove`;
      }
      // If it's handled by pip
      else if (installedPipPackagesNames[name]) {
        errorMsg = `Failure: ${name} is handled by pip, cannot remove`;
      }
      // If it's not installed
      else if (!installedCondaPackagesNames[name]) {
        errorMsg = `Failure: ${name} is not installed`;
      }

      if (errorMsg) {
        logger?.error(errorMsg);
        throw new Error(errorMsg);
      }

      return true;
    })
  );

  // Remove specs to remove
  const newSpecs = env.specs.filter(
    spec => !toRemove.has(packageNameFromSpec(spec) || '')
  );

  logger?.log(`Specs: ${newSpecs.join(', ')}`);
  logger?.log(`Channels: ${env.channelPriority.join(', ')}`);
  logger?.log('');

  return await solve({
    ymlOrSpecs: newSpecs,
    currentLock: env,
    logger
  });
}

/**
 * Install pip packages in an existing environment
 * @param specs the pip packages specs
 * @param env the current environment
 * @param logger the logs handler
 * @returns the solved environment
 */
export async function pipInstall(
  specs: string[],
  env: ILock,
  logger?: ILogger
): Promise<ILock> {
  return await solve({
    pipSpecs: specs,
    currentLock: env,
    logger
  });
}

/**
 * Uninstall pip packages in an existing environment
 * @param packages the pip packages to remove
 * @param env the current environment
 * @param logger the logs handler
 * @returns the solved environment
 */
export async function pipUninstall(
  packages: string[],
  env: ILock,
  logger?: ILogger
): Promise<ILock> {
  const newPipPackages = { ...env.pipPackages };

  // Mapping: installed package name -> dist filename
  const installedPipPackagesNames: { [key: string]: string } = {};
  Object.keys(env.pipPackages).map(filename => {
    installedPipPackagesNames[env.pipPackages[filename].name] = filename;
  });
  const installedCondaPackagesNames: { [key: string]: string } = {};
  Object.keys(env.packages).map(filename => {
    installedCondaPackagesNames[env.packages[filename].name] = filename;
  });

  packages.forEach((pkg: string) => {
    if (installedCondaPackagesNames[pkg]) {
      logger?.warn(`WARNING: Skipping ${pkg} as it is not installed with pip.`);

      return;
    }

    if (!installedPipPackagesNames[pkg]) {
      logger?.warn(`WARNING: Skipping ${pkg} as it is not installed.`);

      return;
    }

    // Manually delete the pip package from the installed list
    delete newPipPackages[installedPipPackagesNames[pkg]];

    logger?.log(`Successfully uninstalled ${pkg}`);
  });

  env.pipPackages = newPipPackages;

  return env;
}

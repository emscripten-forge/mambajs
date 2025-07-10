import {
  getPythonVersion,
  IEnv,
  IEnvPackages,
  ILogger,
  ISolvedPackages,
  packageNameFromSpec,
  parseEnvYml,
  showEnvironmentDiff,
  showPackagesList,
  splitPipPackages
} from '@emscripten-forge/mambajs-core';
import { getSolvedPackages, ISolveOptions } from './solver';
import { getPipPackageName, hasPipDependencies, solvePip } from './solverpip';

// For backward compat
export * from '@emscripten-forge/mambajs-core';

export async function solve(options: ISolveOptions): Promise<IEnvPackages> {
  const { logger, ymlOrSpecs, pipSpecs, installedPackages } = options;
  const { installedPipPackages, installedCondaPackages } =
    splitPipPackages(installedPackages);
  let condaPackages: ISolvedPackages = installedCondaPackages;

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
      condaPackages = await getSolvedPackages(options);
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

      if (!installedPackages) {
        showPackagesList(condaPackages, logger);
      } else {
        showEnvironmentDiff(installedPackages, condaPackages, logger);
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  let pipPackages: ISolvedPackages = installedPipPackages;

  // Run pip install second
  if (typeof ymlOrSpecs === 'string' || pipSpecs?.length) {
    if (!pythonVersion) {
      const msg =
        'Cannot install pip dependencies without Python installed in the environment!';
      logger?.error(msg);
      throw msg;
    }

    if (typeof ymlOrSpecs === 'string' && hasPipDependencies(ymlOrSpecs)) {
      logger?.log('');
      logger?.log('Process pip requirements ...\n');

      pipPackages = await solvePip(
        ymlOrSpecs,
        condaPackages,
        installedWheels,
        installedPipPackages,
        [],
        logger
      );
    } else {
      logger?.log('Process pip requirements ...\n');
      pipPackages = await solvePip(
        '',
        condaPackages,
        installedWheels,
        installedPipPackages,
        pipSpecs,
        logger
      );
    }
  }

  return {
    condaPackages,
    pipPackages
  };
}

/**
 * Create an environment from an environment.yml definition
 * @param yml the environment.yml file content
 * @param logger the logs handler
 * @returns the solved environment
 */
export async function create(yml: string, logger?: ILogger): Promise<IEnv> {
  const parsedYml = parseEnvYml(yml);

  const packages = await solve({ ymlOrSpecs: yml, logger });

  return {
    channels: parsedYml.channels,
    specs: parsedYml.specs,
    packages
  };
}

/**
 * Install conda packages in an existing environment
 * @param specs the new specs
 * @param channels the channels to use
 * @param env the current environment
 * @param logger the logs handler
 * @returns the solved environment
 */
export async function install(
  specs: string[],
  env: IEnv,
  channels?: string[],
  logger?: ILogger
): Promise<IEnv> {
  // Merge existing channels with new ones
  const newChannels: string[] = env.channels || [
    'https://prefix.dev/emscripten-forge-dev',
    'https://prefix.dev/conda-forge'
  ];
  if (channels) {
    for (const channel of channels) {
      if (!newChannels.includes(channel)) {
        newChannels.push(channel);
      }
    }
  }

  // Merge existing specs with new ones
  const newSpecs = Array.from(new Set([...env.specs, ...(specs || [])]));

  logger?.log(`Specs: ${newSpecs.join(', ')}`);
  logger?.log(`Channels: ${newChannels.join(', ')}`);
  logger?.log('');

  const packages = await solve({
    ymlOrSpecs: newSpecs,
    channels: newChannels,
    installedPackages: {
      ...env.packages.condaPackages,
      ...env.packages.pipPackages
    },
    logger
  });

  return {
    channels: newChannels,
    specs: newSpecs,
    packages
  };
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
  env: IEnv,
  logger?: ILogger
): Promise<IEnv> {
  // Get packages for which we have specs already
  const specsPackages = new Set(
    env.specs.map(spec => packageNameFromSpec(spec))
  );

  // Mapping: installed package name -> dist filename
  const installedPipPackagesNames: { [key: string]: string } = {};
  Object.keys(env.packages.pipPackages).map(filename => {
    installedPipPackagesNames[env.packages.pipPackages[filename].name] =
      filename;
  });
  const installedCondaPackagesNames: { [key: string]: string } = {};
  Object.keys(env.packages.condaPackages).map(filename => {
    installedCondaPackagesNames[env.packages.condaPackages[filename].name] =
      filename;
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
  logger?.log(`Channels: ${env.channels.join(', ')}`);
  logger?.log('');

  const newEnvPackages = await solve({
    ymlOrSpecs: newSpecs,
    installedPackages: {
      ...env.packages.condaPackages,
      ...env.packages.pipPackages
    },
    channels: env.channels,
    logger
  });

  return {
    channels: env.channels,
    specs: newSpecs,
    packages: newEnvPackages
  };
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
  env: IEnv,
  logger?: ILogger
): Promise<IEnv> {
  const packages = await solve({
    pipSpecs: specs,
    installedPackages: {
      ...env.packages.condaPackages,
      ...env.packages.pipPackages
    },
    logger
  });

  return {
    channels: env.channels,
    specs: env.specs,
    packages
  };
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
  env: IEnv,
  logger?: ILogger
): Promise<IEnv> {
  const newPipPackages = { ...env.packages.pipPackages };

  // Mapping: installed package name -> dist filename
  const installedPipPackagesNames: { [key: string]: string } = {};
  Object.keys(env.packages.pipPackages).map(filename => {
    installedPipPackagesNames[env.packages.pipPackages[filename].name] =
      filename;
  });
  const installedCondaPackagesNames: { [key: string]: string } = {};
  Object.keys(env.packages.condaPackages).map(filename => {
    installedCondaPackagesNames[env.packages.condaPackages[filename].name] =
      filename;
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

  return {
    channels: env.channels,
    specs: env.specs,
    packages: {
      condaPackages: env.packages.condaPackages,
      pipPackages: newPipPackages
    }
  };
}

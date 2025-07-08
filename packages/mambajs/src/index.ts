import {
  getPythonVersion,
  ISolvedPackages,
  showEnvironmentDiff,
  showPackagesList,
  splitPipPackages,
  IEnvPackages
} from '@emscripten-forge/mambajs-core';
import { getSolvedPackages, ISolveOptions } from './solver';
import { getPipPackageName, hasPipDependencies, solvePip } from './solverpip';

// For backward compat
export * from '@emscripten-forge/mambajs-core';

export async function solve(
  options: ISolveOptions
): Promise<IEnvPackages> {
  const { logger, ymlOrSpecs, pipSpecs, installedPackages } = options;
  const { installedPipPackages, installedCondaPackages } =
    splitPipPackages(installedPackages);
  let condaPackages: ISolvedPackages = installedCondaPackages;

  // Create a wheel -> package name lookup table
  const installedWheels: { [name: string]: string } = {};
  for (const wheelname of Object.keys(installedPipPackages)) {
    installedWheels[installedPipPackages[wheelname].name] = wheelname;
  }

  if (ymlOrSpecs && ymlOrSpecs.length) {
    try {
      condaPackages = await getSolvedPackages(options);

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

  if (typeof ymlOrSpecs === 'string') {
    if (hasPipDependencies(ymlOrSpecs)) {
      if (!getPythonVersion(Object.values(condaPackages))) {
        const msg =
          'Cannot install pip dependencies without Python installed in the environment!';
        logger?.error(msg);
        throw msg;
      }
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
    }
  } else if (pipSpecs?.length) {
    if (!getPythonVersion(Object.values(condaPackages))) {
      const msg =
        'Cannot install pip dependencies without Python installed in the environment!';
      logger?.error(msg);
      throw msg;
    }

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

  return {
    condaPackages,
    pipPackages
  };
}

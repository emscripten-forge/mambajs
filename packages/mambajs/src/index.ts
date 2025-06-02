import {
  getPythonVersion,
  ISolvedPackages,
  showEnvironmentDiff,
  showPackagesList,
  splitPipPackages
} from '@emscripten-forge/mambajs-core';
import { getSolvedPackages, ISolveOptions } from './solver';
import { hasPipDependencies, solvePip } from './solverpip';

// For backward compat
export * from '@emscripten-forge/mambajs-core';

export async function solve(
  options: ISolveOptions
): Promise<{ condaPackages: ISolvedPackages; pipPackages: ISolvedPackages }> {
  const { logger, ymlOrSpecs, pipSpecs, installedPackages } = options;
  const { installedPipPackages, installedCondaPackages } =
    splitPipPackages(installedPackages);
  let condaPackages: ISolvedPackages = installedCondaPackages;

  if (ymlOrSpecs && ymlOrSpecs.length) {
    try {
      condaPackages = await getSolvedPackages(options);

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

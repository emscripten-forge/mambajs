import {
  getPythonVersion,
  ILogger,
  ISolvedPackages,
  showEnvironmentDiff,
  showPackagesList,
  splitPipPackages
} from '@emscripten-forge/mambajs-core';
import { getSolvedPackages, ISolveOptions } from './solver';
import {
  getPackageName,
  getPipPackageName,
  hasPipDependencies,
  solvePip
} from './solverpip';

// For backward compat
export * from '@emscripten-forge/mambajs-core';

export async function solve(
  options: ISolveOptions
): Promise<{ condaPackages: ISolvedPackages; pipPackages: ISolvedPackages }> {
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

export async function solveWithoutPackages(
  specs: string[],
  pipSpecs: string[],
  installedPackages: ISolvedPackages,
  logger: ILogger
) {
  let newSpecs: string[] = getSpecs(installedPackages, specs);
  let newPipSpecs: string[] = getSpecs(installedPackages, pipSpecs);

  return await solve({
    ymlOrSpecs: newSpecs,
    installedPackages: installedPackages,
    pipSpecs: newPipSpecs,
    channels: [], //?
    logger: logger
  });
}

function getSpecs(installedPackages: ISolvedPackages, specs: string[]) {
  const newSpecs: string[] = [];
  if (specs.length) {
    Object.keys(installedPackages).forEach(filename => {
      const pkg = installedPackages[filename];
      let isInSpecs = false;
      specs.filter((spec: string) => {
        const nameMatch = getPackageName(spec);
        if (nameMatch !== null) {
          const packageName = nameMatch[1];
          if (pkg.name === packageName) {
            isInSpecs = true;
          }
        }
      });
      if (!isInSpecs) {
        newSpecs.push(pkg.name);
      }
    });
  }
  return newSpecs;
}

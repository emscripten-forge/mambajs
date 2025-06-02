// A dumb pip "solver" which does a tiny bit of version matching

import { parse } from 'yaml';
import {
  ILogger,
  ISolvedPackage,
  ISolvedPackages
} from '@emscripten-forge/mambajs-core';

interface ISpec {
  package: string;

  constraints: string | null;
}

function formatConstraintVersion(constraintVersion: string, version: string) {
  const constraintVersionArr = constraintVersion.split('.');
  const versionArr = version.split('.');

  while (constraintVersionArr.length < versionArr.length) {
    constraintVersionArr.push('0');
  }

  return constraintVersionArr.join('.');
}

function parseVersion(version: string) {
  return version
    .replace(/(\d+)/g, m => m.padStart(10, '0')) // Pad numbers for proper comparison
    .replace(/([a-z]+)/g, '.$1.'); // Ensure pre-release parts are separated
}

function compareVersions(a: string, b: string) {
  return parseVersion(a).localeCompare(parseVersion(b));
}

function rcompare(a: string, b: string) {
  return compareVersions(a, b);
}

function satisfies(version: string, constraint: string) {
  const constraints = constraint.split(',').map(c => c.trim());

  return constraints.every(c => {
    const match = c.match(/(>=|<=|>|<|==)?\s*([\w.]+)/);
    if (!match) {
      return false;
    }

    const [, operator, constraintVersion] = match;
    const cmp = compareVersions(
      version,
      formatConstraintVersion(constraintVersion, version)
    );

    switch (operator) {
      case '>':
        return cmp > 0;
      case '>=':
        return cmp >= 0;
      case '<':
        return cmp < 0;
      case '<=':
        return cmp <= 0;
      case '==':
        return cmp === 0;
      default:
        return false;
    }
  });
}

function isStable(version: string) {
  return !/[a-zA-Z]/.test(version); // A stable version has no alpha/beta/rc letters
}

function resolveVersion(availableVersions: string[], constraint: string) {
  const validVersions = availableVersions
    .filter(v => satisfies(v, constraint))
    .sort(rcompare)
    .reverse();

  // Prioritize stable versions
  const stableVersions = validVersions.filter(isStable);
  return stableVersions.length
    ? stableVersions[0]
    : validVersions[0] || undefined;
}

function parsePyPiRequirement(requirement: string): ISpec | null {
  const nameMatch = requirement.match(/^([a-zA-Z0-9_-]+)/);

  if (!nameMatch) {
    return null;
  }

  const packageName = nameMatch[1];

  return {
    package: packageName,
    constraints: requirement.slice(packageName.length) || null
  };
}

function getSuitableVersion(
  pkgInfo: any,
  constraints: string | null
): ISolvedPackage | undefined {
  const availableVersions = Object.keys(pkgInfo.releases);

  let version: string | undefined = undefined;
  try {
    if (constraints) {
      version = resolveVersion(availableVersions, constraints);
    }
  } catch {
    // We'll pick the latest version
  }

  // Pick latest stable version
  if (!version) {
    version = availableVersions.filter(isStable).sort(rcompare).reverse()[0];
  }

  const urls = pkgInfo.releases[version];
  for (const url of urls) {
    // Needs to finish with:
    // none: no compiled code
    // any: noarch package
    if (url.filename.endsWith('none-any.whl')) {
      return { url: url.url, name: url.filename, version };
    }
  }
}

async function processRequirement(
  requirement: ISpec,
  warnedPackages: Set<string>,
  pipSolvedPackages: ISolvedPackages,
  installedCondaPackagesNames: Set<string>,
  installedWheels: { [name: string]: string },
  installPipPackagesLookup: ISolvedPackages,
  logger?: ILogger,
  required = false
) {
  const pkgMetadata = await (
    await fetch(`https://pypi.org/pypi/${requirement.package}/json`)
  ).json();

  const solved = getSuitableVersion(pkgMetadata, requirement.constraints);
  if (!solved) {
    const msg = `\x1b[38;5;208mCannot install ${requirement.package} from PyPi. Please make sure to install it from conda-forge or emscripten-forge! e.g. "conda install ${requirement.package}\x1b[0m"`;

    // Package is a direct requirement requested by the user, we throw an error
    if (required) {
      logger?.error(msg);
      throw new Error(msg);
    }

    if (!warnedPackages.has(requirement.package)) {
      logger?.warn(msg);
      warnedPackages.add(requirement.package);
    }

    return;
  }

  // Remove old version (if exists) and add new one
  if (installPipPackagesLookup[requirement.package]) {
    delete pipSolvedPackages[installedWheels[requirement.package]];
  }
  pipSolvedPackages[solved.name] = {
    name: requirement.package,
    version: solved.version,
    url: solved.url,
    repo_name: 'PyPi'
  };

  if (!pkgMetadata.info.requires_dist) {
    return;
  }

  // Process its dependencies
  for (const requirement of pkgMetadata.info.requires_dist as string[]) {
    // TODO Skipping extras for now, we need to support them
    if (requirement.includes(';')) {
      continue;
    }

    const parsedRequirement = parsePyPiRequirement(requirement);
    if (!parsedRequirement) {
      continue;
    }

    // Ignoring already installed package through conda
    if (installedCondaPackagesNames.has(parsedRequirement.package)) {
      if (!warnedPackages.has(parsedRequirement.package)) {
        logger?.log(
          `Requirement ${parsedRequirement.package} already satisfied.`
        );
      }
      warnedPackages.add(parsedRequirement.package);
      continue;
    }

    // Ignoring already installed package through pip
    const alreadyInstalled =
      installPipPackagesLookup[parsedRequirement.package];
    if (
      alreadyInstalled &&
      (!parsedRequirement.constraints ||
        satisfies(alreadyInstalled.version, parsedRequirement.constraints))
    ) {
      if (!warnedPackages.has(parsedRequirement.package)) {
        logger?.log(
          `Requirement ${parsedRequirement.package}${parsedRequirement.constraints || ''} already satisfied.`
        );
      }
      warnedPackages.add(parsedRequirement.package);
      continue;
    }

    await processRequirement(
      parsedRequirement,
      warnedPackages,
      pipSolvedPackages,
      installedCondaPackagesNames,
      installedWheels,
      installPipPackagesLookup,
      logger,
      false
    );
  }
}

export async function solvePip(
  yml: string,
  installedCondaPackages: ISolvedPackages,
  installedWheels: { [name: string]: string },
  installedPipPackages: ISolvedPackages,
  packageNames: Array<string> = [],
  logger?: ILogger
): Promise<ISolvedPackages> {
  let specs: ISpec[] = [];

  if (yml) {
    const data = parse(yml);
    const packages = data?.dependencies ? data.dependencies : [];

    // Get pip dependencies
    for (const pkg of packages) {
      if (typeof pkg !== 'string' && Array.isArray(pkg.pip)) {
        specs = parsePipPackage(pkg.pip);
      }
    }
  } else if (packageNames.length) {
    specs = parsePipPackage(packageNames);
  }

  // Create lookup tables for already installed packages
  // Pip will not take ownership of install conda packages, it cannot update them
  // Pip can only update pip-installed packages and install new ones
  const installedCondaPackagesNames = new Set<string>();
  for (const installedPackage of Object.values(installedCondaPackages)) {
    const pipPackageName = await getPipPackageName(installedPackage.name);
    installedCondaPackagesNames.add(pipPackageName);
  }

  // Create pip package lookup we can more easily use (index by package name, not wheel name)
  const installPipPackagesLookup: ISolvedPackages = {};
  for (const installedPackage of Object.values(installedPipPackages)) {
    installPipPackagesLookup[installedPackage.name] = installedPackage;
  }

  const warnedPackages = new Set<string>();
  const pipSolvedPackages: ISolvedPackages = { ...installedPipPackages };
  for (const spec of specs) {
    // Ignoring already installed package via conda
    if (installedCondaPackagesNames.has(spec.package)) {
      logger?.log(
        `Requirement ${spec.package} already handled by conda/micromamba/mamba.`
      );
      continue;
    }

    const alreadyInstalled = installPipPackagesLookup[spec.package];
    if (
      alreadyInstalled &&
      (!spec.constraints ||
        satisfies(alreadyInstalled.version, spec.constraints))
    ) {
      logger?.log(
        `Requirement ${spec.package}${spec.constraints || ''} already satisfied.`
      );
      continue;
    }

    await processRequirement(
      spec,
      warnedPackages,
      pipSolvedPackages,
      installedCondaPackagesNames,
      installedWheels,
      installPipPackagesLookup,
      logger,
      true
    );
  }

  const oldPackagesLookup: ISolvedPackages = {};
  for (const pkg of Object.values(installedPipPackages)) {
    oldPackagesLookup[pkg.name] = pkg;
  }

  if (Object.values(pipSolvedPackages).length) {
    const newPkgs: string[] = [];
    for (const pkg of Object.values(pipSolvedPackages)) {
      if (
        !oldPackagesLookup[pkg.name] ||
        oldPackagesLookup[pkg.name].version !== pkg.version
      ) {
        newPkgs.push(`${pkg.name}-${pkg.version}`);
      }
    }
    if (newPkgs.length) {
      logger?.log(`Successfully installed ${newPkgs.join(' ')}`);
    }
  }

  return pipSolvedPackages;
}

function parsePipPackage(pipPackages: Array<string>): ISpec[] {
  const specs: ISpec[] = [];
  for (const pipPkg of pipPackages) {
    const parsedSpec = parsePyPiRequirement(pipPkg);
    if (parsedSpec) {
      specs.push(parsedSpec);
    }
  }
  return specs;
}

export async function getPipPackageName(
  packageName: string,
  logger?: ILogger
): Promise<string> {
  let result = packageName;
  try {
    const url =
      'https://raw.githubusercontent.com/prefix-dev/parselmouth/main/files/compressed_mapping.json';
    const response = await fetch(url);
    if (!response.ok && logger) {
      logger.error('Cannot parse pip package mapping json');
    }

    const packageMapping = await response.json();

    if (packageMapping.hasOwnProperty(packageName)) {
      result = packageMapping[packageName];
    }
  } catch (error) {
    logger?.error('Cannot get pip package names', error);
  }
  return result;
}

export function hasPipDependencies(yml?: string): boolean {
  if (yml) {
    const data = parse(yml);
    const packages = data?.dependencies ? data.dependencies : [];
    for (const pkg of packages) {
      if (typeof pkg !== 'string' && Array.isArray(pkg.pip)) {
        return true;
      }
    }
    return false;
  }

  return false;
}

// A dumb pip "solver" which does a tiny bit of version matching

import { parse } from 'yaml';
import {
  ILogger,
  ISolvedPackage,
  ISolvedPackages,
  packageNameFromSpec,
  parseEnvYml
} from '@emscripten-forge/mambajs-core';

interface ISpec {
  package: string;

  constraints: string | null;
  extras?: string[];
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
  const extrasMatch = requirement.match(/^([^\[]+)\[([^\]]+)\]/);
  const packageName = extrasMatch
    ? extrasMatch[1]
    : packageNameFromSpec(requirement);
  const extras = extrasMatch
    ? extrasMatch[2].split(',').map(e => e.trim())
    : [];

  if (!packageName) {
    return null;
  }

  const extrasSuffix = extras.length ? `[${extras.join(',')}]` : '';
  const baseNameLength = packageName.length + extrasSuffix.length;

  return {
    package: packageName,
    constraints: requirement.slice(baseNameLength) || null,
    extras: extras.length ? extras : undefined
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

  if (pkgMetadata.message === 'Not Found') {
    const msg = `ERROR: Could not find a version that satisfies the requirement ${requirement.package}`;
    logger?.error(msg);
    throw new Error(msg);
  }

  const solved = getSuitableVersion(pkgMetadata, requirement.constraints);
  if (!solved) {
    const msg = `Cannot install ${requirement.package} from PyPi. Please make sure to install it from conda-forge or emscripten-forge! e.g. "%conda install ${requirement.package}"`;

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
    delete installPipPackagesLookup[requirement.package];
    delete installedWheels[requirement.package];
  }

  const requiresDist = pkgMetadata.info.requires_dist as string[] | undefined;

  pipSolvedPackages[solved.name] = {
    name: requirement.package,
    version: solved.version,
    url: solved.url,
    repo_name: 'PyPi',
    depends: requiresDist || []
  };
  installedWheels[requirement.package] = solved.name;
  installPipPackagesLookup[requirement.package] =
    pipSolvedPackages[solved.name];

  if (!requiresDist) {
    return;
  }

  for (const raw of requiresDist) {
    const [requirements, envMarker] = raw.split(';').map(s => s.trim());

    // Filter out extras not explicitly requested
    if (
      envMarker &&
      !requirement.extras?.some(extra =>
        envMarker.includes(`extra == "${extra}"`)
      )
    ) {
      continue;
    }

    const parsedRequirement = parsePyPiRequirement(requirements);
    if (!parsedRequirement) {
      continue;
    }

    // Don't pass down parent extras unless needed (PyPI handles it via markers)
    parsedRequirement.extras = undefined;
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
    const data = parseEnvYml(yml);
    specs = parsePipPackage(data.pipSpecs);
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

const CONDA_PACKAGE_MAPPING_URL =
  'https://raw.githubusercontent.com/prefix-dev/parselmouth/main/files/compressed_mapping.json';
const CONDA_PACKAGE_MAPPING = fetch(CONDA_PACKAGE_MAPPING_URL).then(
  async response => {
    if (!response.ok) {
      console.error('Failed to get conda->pip package mapping');
      return undefined;
    }

    return await response.json();
  }
);

export async function getPipPackageName(packageName: string): Promise<string> {
  const packageMapping = await CONDA_PACKAGE_MAPPING;

  if (packageMapping && packageMapping[packageName]) {
    return packageMapping[packageName];
  } else {
    return packageName;
  }
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

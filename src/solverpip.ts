// A dumb pip "solver" which does a tiny bit of version matching

import { parse } from 'yaml';
import { ILogger, ISolvedPackage, ISolvedPackages } from './helper';

interface ISpec {
  package: string;

  constraints: string | null;
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
    const cmp = compareVersions(version, constraintVersion);

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
  pipSolvedPackages: ISolvedPackages,
  pipInstalledPackages: Set<string>,
  installedPackages: Set<string>,
  logger?: ILogger
) {
  const pkgMetadata = await (
    await fetch(`https://pypi.org/pypi/${requirement.package}/json`)
  ).json();

  const solved = getSuitableVersion(pkgMetadata, requirement.constraints);
  if (!solved) {
    logger?.warn(
      `Cannot install ${requirement.package} from PyPi. Please make sure to install it from conda-forge or emscripten-forge!`
    );

    return;
  }
  logger?.log(
    `${requirement.package}${requirement.constraints || ''}: Installing ${solved.version}`
  );

  pipInstalledPackages.add(requirement.package);
  pipSolvedPackages[solved.name] = {
    name: requirement.package,
    version: solved.version,
    url: solved.url
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

    // Only process package if it's not already being installed
    if (
      !installedPackages.has(parsedRequirement.package) &&
      !pipInstalledPackages.has(parsedRequirement.package)
    ) {
      await processRequirement(
        parsedRequirement,
        pipSolvedPackages,
        pipInstalledPackages,
        installedPackages,
        logger
      );
    }
  }
}

export async function solvePip(
  yml: string,
  installed: ISolvedPackages,
  logger?: ILogger
): Promise<ISolvedPackages> {
  const data = parse(yml);
  const packages = data?.dependencies ? data.dependencies : [];

  const specs: ISpec[] = [];
  // Get pip dependencies
  for (const pkg of packages) {
    if (typeof pkg !== 'string' && Array.isArray(pkg.pip)) {
      for (const pipPkg of pkg.pip) {
        const parsedSpec = parsePyPiRequirement(pipPkg);
        if (parsedSpec) {
          specs.push(parsedSpec);
        }
      }
    }
  }

  const installedPackages = new Set<string>();
  for (const installedPackage of Object.values(installed)) {
    installedPackages.add(installedPackage.name);
  }

  const pipSolvedPackages: ISolvedPackages = {};
  const pipInstalledPackages = new Set<string>();
  for (const spec of specs) {
    await processRequirement(
      spec,
      pipSolvedPackages,
      pipInstalledPackages,
      installedPackages,
      logger
    );
  }

  return pipSolvedPackages;
}

export function hasPipDependencies(yml: string): boolean {
  const data = parse(yml);
  const packages = data?.dependencies ? data.dependencies : [];
  for (const pkg of packages) {
    if (typeof pkg !== 'string' && Array.isArray(pkg.pip)) {
      return true;
    }
  }

  return false;
}

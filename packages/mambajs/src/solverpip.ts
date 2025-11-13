// A dumb pip "solver" which does a tiny bit of version matching

import { parse } from 'yaml';
import {
  DEFAULT_PLATFORM,
  getPythonVersionFromPackages,
  ILogger,
  ISolvedPackages,
  ISolvedPipPackage,
  ISolvedPipPackages,
  packageNameFromSpec,
  parseEnvYml
} from '@emscripten-forge/mambajs-core';
import { Platform } from '@conda-org/rattler';

interface ISpec {
  package: string;
  constraints: string | null;
  extras?: string[];
}

interface IWheelInfo {
  distribution: string;
  version: string;
  buildTag?: string;
  pythonTag: string;
  abiTag: string;
  platformTags: string[];
}

function parseWheelFilename(filename: string): IWheelInfo {
  if (!filename.endsWith('.whl')) {
    throw new Error('Invalid wheel filename: must end with .whl');
  }

  const base = filename.slice(0, -4); // strip ".whl"
  const parts = base.split('-');

  if (parts.length < 4) {
    throw new Error(
      `Invalid wheel filename: not enough parts in '${filename}'`
    );
  }

  // According to PEP 427 the last three hyphen-separated fields are:
  //   pythonTag - abiTag - platformTag
  // Everything before that is: distribution - version (- buildTag?) ...
  const pythonTag = parts[parts.length - 3];
  const abiTag = parts[parts.length - 2];
  const platformField = parts[parts.length - 1]; // may contain dots separating multiple platform tags

  const distribution = parts[0];
  const version = parts[1];

  // anything between version (index 1) and pythonTag (index length-3) is the optional build tag.
  const maybeBuildParts = parts.slice(2, parts.length - 3);
  const buildTag =
    maybeBuildParts.length > 0 ? maybeBuildParts.join('-') : undefined;

  const platformTags = platformField.split('.');

  return {
    distribution,
    version,
    buildTag,
    pythonTag,
    abiTag,
    platformTags
  };
}

function isPythonTagCompatible(
  pythonTag: string,
  pythonVersion: number[]
): boolean {
  const [major, minor] = pythonVersion;
  const versionNum = `${major}${minor}`; // e.g. [3, 11] → "311"

  pythonTag = pythonTag.toLowerCase();

  // Generic tags
  if (pythonTag === `py${major}`) return true;

  // Cross-version tags like "py2.py3"
  if (pythonTag.includes('.')) {
    const parts = pythonTag.split('.');
    return parts.some(tag => isPythonTagCompatible(tag, pythonVersion));
  }

  // CPython version-specific tags like "cp311"
  if (pythonTag.startsWith('cp')) {
    const tagVersion = pythonTag.slice(2); // e.g. "cp311" → "311"
    return tagVersion === versionNum;
  }

  // Generic pure-Python tags
  if (pythonTag === 'py2' && major === 2) return true;
  if (pythonTag === 'py') return true; // catch-all

  // Non-CPython (PyPy, Jython, etc.) — assume incompatible?
  return false;
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
    const match = c.match(/(=|~=|>=|<=|>|<|==)?\s*([\w.]+)/);
    if (!match) {
      return false;
    }

    const [, operator, constraintVersion] = match;
    const cmp = compareVersions(
      version,
      formatConstraintVersion(constraintVersion, version)
    );

    switch (operator) {
      case '=':
        throw new Error(
          `ERROR: Invalid requirement: '${c}': Hint: = is not a valid operator. Did you mean == ?`
        );
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
      case '~=': {
        // Compatible release: ~=X.Y is equivalent to >=X.Y, ==X.*
        const constraintParts = constraintVersion.split('.');
        const versionParts = version.split('.');

        // Check if version is >= constraintVersion
        if (cmp < 0) {
          return false;
        }

        // Check if the version matches the constraint up to the last specified component
        // For ~=0.1, allow 0.1.x but not 0.2.x
        for (let i = 0; i < constraintParts.length - 1; i++) {
          if (versionParts[i] !== constraintParts[i]) {
            return false;
          }
        }

        return true;
      }
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
  constraints: string | null,
  pythonVersion: number[],
  logger?: ILogger,
  platform?: Platform
): ISolvedPipPackage | undefined {
  const availableVersions = Object.keys(pkgInfo.releases);

  let version: string | undefined = undefined;
  if (constraints) {
    try {
      version = resolveVersion(availableVersions, constraints);
    } catch (e: any) {
      const msg = e.message ? e.message : e;
      logger?.error(msg);
      throw new Error(msg);
    }

    if (!version) {
      const versionsStr = availableVersions.join(', ');
      const msg = `ERROR: Could not find a version that satisfies the requirement ${pkgInfo.info.name}${constraints} (from versions: ${versionsStr})`;
      const notFoundMsg = `ERROR: No matching distribution found for ${pkgInfo.info.name}${constraints}`;

      logger?.error(msg);
      logger?.error(notFoundMsg);
      throw new Error(msg);
    }
  }

  if (!version) {
    version = availableVersions.filter(isStable).sort(rcompare).reverse()[0];
  }

  const urls: any[] = pkgInfo.releases[version];

  // Helper function to convert conda platform to pip wheel platform tags
  const getPlatformTags = (platform?: string): string[] => {
    if (!platform) {
      return ['any'];
    }

    const tags: string[] = ['any']; // Always include pure Python packages

    switch (platform) {
      case 'linux-64':
        tags.push(
          'linux_x86_64',
          'manylinux1_x86_64',
          'manylinux2010_x86_64',
          'manylinux2014_x86_64',
          'manylinux_2_17_x86_64',
          'manylinux_2_24_x86_64',
          'manylinux_2_28_x86_64'
        );
        break;
      case 'linux-32':
        tags.push(
          'linux_i686',
          'manylinux1_i686',
          'manylinux2010_i686',
          'manylinux2014_i686'
        );
        break;
      case 'linux-aarch64':
        tags.push(
          'linux_aarch64',
          'manylinux2014_aarch64',
          'manylinux_2_17_aarch64',
          'manylinux_2_24_aarch64',
          'manylinux_2_28_aarch64'
        );
        break;
      case 'linux-armv6l':
        tags.push('linux_armv6l');
        break;
      case 'linux-armv7l':
        tags.push('linux_armv7l');
        break;
      case 'linux-ppc64le':
        tags.push(
          'linux_ppc64le',
          'manylinux2014_ppc64le',
          'manylinux_2_17_ppc64le'
        );
        break;
      case 'linux-ppc64':
        tags.push('linux_ppc64');
        break;
      case 'linux-s390x':
        tags.push('linux_s390x', 'manylinux2014_s390x', 'manylinux_2_17_s390x');
        break;
      case 'osx-64':
        tags.push(
          'macosx_10_6_x86_64',
          'macosx_10_9_x86_64',
          'macosx_10_12_x86_64',
          'macosx_10_13_x86_64',
          'macosx_10_14_x86_64',
          'macosx_10_15_x86_64',
          'macosx_11_0_x86_64',
          'macosx_12_0_x86_64'
        );
        break;
      case 'osx-arm64':
        tags.push(
          'macosx_11_0_arm64',
          'macosx_12_0_arm64',
          'macosx_13_0_arm64',
          'macosx_14_0_arm64'
        );
        break;
      case 'win-64':
        tags.push('win_amd64');
        break;
      case 'win-32':
        tags.push('win32');
        break;
      case 'win-arm64':
        tags.push('win_arm64');
        break;
      case 'emscripten-wasm32':
      case 'wasi-wasm32':
        // These platforms typically only support pure Python packages
        break;
    }

    return tags;
  };

  const suitablePlatformTags = getPlatformTags(platform);

  const wheelUrls = urls.filter(url => url.filename.endsWith('.whl'));
  const sourceUrls = urls.filter(url => url.filename.endsWith('.tar.gz'));

  for (const url of wheelUrls) {
    const wheelInfo = parseWheelFilename(url.filename);

    // Check that the url is for the current Python version
    if (!isPythonTagCompatible(wheelInfo.pythonTag, pythonVersion)) {
      continue;
    }

    // Check if any of the platform tags match the wheel filename
    for (const tag of suitablePlatformTags) {
      if (wheelInfo.platformTags.includes(tag)) {
        return {
          url: url.url,
          name: url.filename,
          version,
          registry: 'PyPi'
        };
      }
    }
  }

  // Installing from source as a fallback
  if (
    sourceUrls[0] &&
    !['emscripten-wasm32', 'wasi-wasm32'].includes(
      platform ?? 'emscripten-wasm32'
    )
  ) {
    return {
      url: sourceUrls[0].url,
      name: sourceUrls[0].filename,
      version,
      registry: 'PyPi'
    };
  }

  const versionsStr = availableVersions.join(', ');
  const msg = `ERROR: Could not find a valid distribution for ${pkgInfo.info.name}${constraints} (from versions: ${versionsStr})`;
  const notFoundMsg = getUnavailableWheelError(pkgInfo.info.name, platform);

  logger?.error([msg, notFoundMsg].join('\n'));
  throw new Error([msg, notFoundMsg].join('\n'));
}

function getUnavailableWheelError(packageName: string, platform: Platform = 'emscripten-wasm32') {
  if (platform === 'emscripten-wasm32') {
    return (
      `Cannot install '${packageName}' from PyPI because it is a binary built package that is not compatible with WASM environments. ` +
      `To resolve this issue, you can: ` +
      `1) Try to install it from emscripten-forge instead: "!mamba install ${packageName}" ` +
      `2) If that doesn't work, it's probably that the package was not made WASM-compatible on emscripten-forge. You can either request or contribute a new recipe for that package in https://github.com/emscripten-forge/recipes `
    );
  }

  return `No wheel available for '${packageName}' for platform '${platform}'`;
}

async function processRequirement(
  requirement: ISpec,
  warnedPackages: Set<string>,
  pipSolvedPackages: ISolvedPipPackages,
  installedCondaPackagesNames: Set<string>,
  installedWheels: { [name: string]: string },
  installPipPackagesLookup: ISolvedPipPackages,
  pythonVersion: number[],
  logger?: ILogger,
  required = false,
  platform?: Platform
) {
  const pkgMetadata = await (
    await fetch(`https://pypi.org/pypi/${requirement.package}/json`)
  ).json();

  if (pkgMetadata.message === 'Not Found') {
    const requirementSpec =
      requirement.package + (requirement.constraints || '');
    const msg = `ERROR: Could not find a version that satisfies the requirement ${requirementSpec}`;
    logger?.error(msg);
    const notFoundMsg = `ERROR: No matching distribution found for ${requirementSpec}`;
    logger?.error(notFoundMsg);
    throw new Error(msg);
  }

  const solved = getSuitableVersion(
    pkgMetadata,
    requirement.constraints,
    pythonVersion,
    logger,
    platform
  );
  if (!solved) {
    const requirementSpec =
      requirement.package + (requirement.constraints || '');

    // Check if constraint resolution failed vs wheel availability issue
    if (requirement.constraints) {
      // Check if constraint resolution succeeded
      const availableVersions = Object.keys(pkgMetadata.releases);
      let constraintResolutionFailed = false;

      try {
        const resolvedVersion = resolveVersion(
          availableVersions,
          requirement.constraints
        );
        constraintResolutionFailed = !resolvedVersion;
      } catch {
        constraintResolutionFailed = true;
      }

      if (constraintResolutionFailed) {
        // Constraint resolution failed - show pip-style error
        const versionsStr = availableVersions.join(', ');
        const msg = `ERROR: Could not find a version that satisfies the requirement ${requirementSpec} (from versions: ${versionsStr})`;
        const notFoundMsg = `ERROR: No matching distribution found for ${requirementSpec}`;

        logger?.error(msg);
        logger?.error(notFoundMsg);
        throw new Error(msg);
      } else {
        const msg = getUnavailableWheelError(requirement.package, platform);

        // Package is a direct requirement requested by the user, we throw an error
        if (required) {
          logger?.error(msg);
          throw new Error(msg);
        }

        if (!warnedPackages.has(requirement.package)) {
          logger?.warn(msg);
          warnedPackages.add(requirement.package);
        }
      }
    } else {
      const msg = getUnavailableWheelError(requirement.package, platform);

      // Package is a direct requirement requested by the user, we throw an error
      if (required) {
        logger?.error(msg);
        throw new Error(msg);
      }

      if (!warnedPackages.has(requirement.package)) {
        logger?.warn(msg);
        warnedPackages.add(requirement.package);
      }
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

  const filteredRequiresDist = (requiresDist || []).filter(raw => {
    const [, envMarker] = raw.split(';').map(s => s.trim());
    if (!envMarker) return true;
    return requirement.extras?.some(extra =>
      envMarker.includes(`extra == "${extra}"`)
    );
  });

  pipSolvedPackages[solved.name] = {
    name: requirement.package,
    version: solved.version,
    url: solved.url,
    registry: 'PyPi'
  };
  installedWheels[requirement.package] = solved.name;
  installPipPackagesLookup[requirement.package] =
    pipSolvedPackages[solved.name];

  if (!filteredRequiresDist) {
    return;
  }

  for (const raw of filteredRequiresDist) {
    const [requirements] = raw.split(';').map(s => s.trim());

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
      pythonVersion,
      logger,
      false,
      platform
    );
  }
}

export async function solvePip(
  yml: string,
  installedCondaPackages: ISolvedPackages,
  installedWheels: { [name: string]: string },
  installedPipPackages: ISolvedPipPackages,
  packageNames: Array<string> = [],
  logger?: ILogger,
  platform?: Platform
): Promise<ISolvedPipPackages> {
  let specs: ISpec[] = [];
  platform = platform ?? DEFAULT_PLATFORM;

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
  const installPipPackagesLookup: ISolvedPipPackages = {};
  for (const installedPackage of Object.values(installedPipPackages)) {
    installPipPackagesLookup[installedPackage.name] = installedPackage;
  }

  const warnedPackages = new Set<string>();
  const pipSolvedPackages: ISolvedPipPackages = { ...installedPipPackages };
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

    const pythonVersion = getPythonVersionFromPackages(installedCondaPackages);
    if (!pythonVersion) {
      throw new Error('Failed to get Python version');
    }

    await processRequirement(
      spec,
      warnedPackages,
      pipSolvedPackages,
      installedCondaPackagesNames,
      installedWheels,
      installPipPackagesLookup,
      pythonVersion,
      logger,
      true,
      platform
    );
  }

  const oldPackagesLookup: ISolvedPipPackages = {};
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

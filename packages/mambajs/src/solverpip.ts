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

const PLATFORM_TAGS = {
  'linux-64': [
    'linux_x86_64',
    'manylinux1_x86_64',
    'manylinux2010_x86_64',
    'manylinux2014_x86_64',
    'manylinux_2_17_x86_64',
    'manylinux_2_24_x86_64',
    'manylinux_2_28_x86_64'
  ],
  'linux-32': [
    'linux_i686',
    'manylinux1_i686',
    'manylinux2010_i686',
    'manylinux2014_i686'
  ],
  'linux-aarch64': [
    'linux_aarch64',
    'manylinux2014_aarch64',
    'manylinux_2_17_aarch64',
    'manylinux_2_24_aarch64',
    'manylinux_2_28_aarch64'
  ],
  'linux-armv6l': ['linux_armv6l'],
  'linux-armv7l': ['linux_armv7l'],
  'linux-ppc64le': [
    'linux_ppc64le',
    'manylinux2014_ppc64le',
    'manylinux_2_17_ppc64le'
  ],
  'linux-ppc64': ['linux_ppc64'],
  'linux-s390x': ['linux_s390x', 'manylinux2014_s390x', 'manylinux_2_17_s390x'],
  'osx-64': [
    'macosx_10_6_x86_64',
    'macosx_10_9_x86_64',
    'macosx_10_12_x86_64',
    'macosx_10_13_x86_64',
    'macosx_10_14_x86_64',
    'macosx_10_15_x86_64',
    'macosx_11_0_x86_64',
    'macosx_12_0_x86_64'
  ],
  'osx-arm64': [
    'macosx_11_0_arm64',
    'macosx_12_0_arm64',
    'macosx_13_0_arm64',
    'macosx_14_0_arm64'
  ],
  'win-64': ['win_amd64'],
  'win-32': ['win32'],
  'win-arm64': ['win_arm64'],
  'emscripten-wasm32': [],
  'wasi-wasm32': []
};

interface IParsedGitHubUrl {
  owner: string;
  repo: string;
  ref: string;
}

interface ISpec {
  package: string;
  constraints: string | null;
  extras?: string[];
  isGitHub?: boolean;
  gitHubUrl?: string;
  gitHubRef?: string;
}

interface IGitHubPackageInfo {
  name: string;
  version: string;
  dependencies: string[];
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

function decodeBase64(base64: string): string {
  // Simple base64 decoder for fallback
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  let i = 0;

  // Remove non-base64 characters
  base64 = base64.replace(/[^A-Za-z0-9+/=]/g, '');

  while (i < base64.length) {
    const enc1 = chars.indexOf(base64.charAt(i++));
    const enc2 = chars.indexOf(base64.charAt(i++));
    const enc3 = chars.indexOf(base64.charAt(i++));
    const enc4 = chars.indexOf(base64.charAt(i++));

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    output += String.fromCharCode(chr1);

    if (enc3 !== 64) {
      output += String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output += String.fromCharCode(chr3);
    }
  }

  return output;
}

/**
 * Fetch with retry logic for handling rate limits
 */
async function fetchWithRetry(
  url: string,
  maxRetries = 5,
  initialDelay = 2000
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);

      // If rate limited (403 or 429), wait and retry
      if (
        (response.status === 403 || response.status === 429) &&
        attempt < maxRetries
      ) {
        const delay = initialDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return response;
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Parse GitHub git+ URLs and fetch the default branch if ref is not provided.
 *
 * Examples:
 *  - git+https://github.com/owner/repo
 *  - git+https://github.com/owner/repo.git
 *  - git+https://github.com/owner/repo@ref
 */
export async function parseGitHubUrl(
  url: string
): Promise<IParsedGitHubUrl | null> {
  // Pattern with optional @ref
  const match = url.match(
    /^git\+https:\/\/github\.com\/([^\/]+)\/([^@\/]+?)(?:\.git)?(?:@(.+))?$/
  );

  if (!match) return null;

  const owner = match[1];
  const repo = match[2];
  const ref = match[3]; // may be undefined

  if (ref) {
    return { owner, repo, ref };
  }

  // No ref: fetch default branch from GitHub API
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const response = await fetchWithRetry(apiUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch repo info from GitHub: ${response.status}`
    );
  }

  const data = await response.json();

  if (!data.default_branch) {
    throw new Error(`Unable to determine default branch for ${owner}/${repo}`);
  }

  return {
    owner,
    repo,
    ref: data.default_branch
  };
}

async function fetchGitHubPackageInfo(
  owner: string,
  repo: string,
  ref: string
): Promise<IGitHubPackageInfo> {
  // Try to fetch setup.py, setup.cfg, or pyproject.toml from the repository
  const files = ['setup.py', 'setup.cfg', 'pyproject.toml'];
  let packageInfo: IGitHubPackageInfo | null = null;

  for (const file of files) {
    try {
      const response = await fetchWithRetry(
        `https://api.github.com/repos/${owner}/${repo}/contents/${file}?ref=${ref}`
      );

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      // Decode base64 content - handle both browser and Node.js
      let content: string;
      if (typeof atob !== 'undefined') {
        content = atob(data.content);
      } else {
        // Fallback base64 decoding
        content = decodeBase64(data.content);
      }

      if (file === 'setup.py') {
        packageInfo = parseSetupPy(content);
      } else if (file === 'setup.cfg') {
        packageInfo = parseSetupCfg(content);
      } else if (file === 'pyproject.toml') {
        packageInfo = parsePyprojectToml(content);
      }

      if (packageInfo) {
        break;
      }
    } catch (error) {
      // Continue to next file
      continue;
    }
  }

  if (!packageInfo) {
    throw new Error(
      `Could not determine package metadata for ${owner}/${repo}@${ref}`
    );
  }

  return packageInfo;
}

function parseSetupPy(content: string): IGitHubPackageInfo | null {
  // Extract name using regex
  const nameMatch = content.match(/name\s*=\s*['"]([\w-]+)['"]/);
  const versionMatch = content.match(/version\s*=\s*['"]([\d.]+)['"]/);

  if (!nameMatch) {
    return null;
  }

  // Extract install_requires for dependencies
  const dependencies: string[] = [];

  // Try to match list format: install_requires = [...]
  const installRequiresListMatch = content.match(
    /install_requires\s*=\s*\[([\s\S]*?)\]/
  );
  if (installRequiresListMatch) {
    const depsContent = installRequiresListMatch[1];
    const depsMatches = depsContent.matchAll(/['"]([\w\->=<.,\s]+)['"]/g);
    for (const match of depsMatches) {
      dependencies.push(match[1].trim());
    }
  } else {
    // Try to match inline single dependency format: install_requires = package >= version
    const installRequiresInlineMatch = content.match(
      /install_requires\s*=\s*([^,\n]+?)(?:\n|$)/
    );
    if (installRequiresInlineMatch) {
      const dep = installRequiresInlineMatch[1].trim();
      // Remove quotes if present
      const cleanDep = dep.replace(/['"]/g, '').trim();
      if (cleanDep && !cleanDep.startsWith('[')) {
        dependencies.push(cleanDep);
      }
    }
  }

  return {
    name: nameMatch[1],
    version: versionMatch ? versionMatch[1] : '0.0.0',
    dependencies
  };
}

function parseSetupCfg(content: string): IGitHubPackageInfo | null {
  // Parse setup.cfg using simple regex
  const nameMatch = content.match(/name\s*=\s*([\w-]+)/);
  const versionMatch = content.match(/version\s*=\s*([\d.]+)/);

  if (!nameMatch) {
    return null;
  }

  // Extract install_requires
  const dependencies: string[] = [];
  const installRequiresMatch = content.match(
    /install_requires\s*=\s*([\s\S]*?)(?:\n\n|\n\[|$)/
  );
  if (installRequiresMatch) {
    const depsLines = installRequiresMatch[1].split('\n');
    for (const line of depsLines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        dependencies.push(trimmed);
      }
    }
  }

  return {
    name: nameMatch[1],
    version: versionMatch ? versionMatch[1] : '0.0.0',
    dependencies
  };
}

function parsePyprojectToml(content: string): IGitHubPackageInfo | null {
  // Simple TOML parsing for [project] or [tool.poetry] sections
  const nameMatch =
    content.match(/name\s*=\s*['"]([\w-]+)['"]/) ||
    content.match(/\[project\][\s\S]*?name\s*=\s*['"]([\w-]+)['"]/);
  const versionMatch =
    content.match(/version\s*=\s*['"]([\d.]+)['"]/) ||
    content.match(/\[project\][\s\S]*?version\s*=\s*['"]([\d.]+)['"]/);

  if (!nameMatch) {
    return null;
  }

  // Extract dependencies
  const dependencies: string[] = [];
  const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depsMatch) {
    const depsContent = depsMatch[1];
    const depsMatches = depsContent.matchAll(/['"]([\w\->=<.,\s]+)['"]/g);
    for (const match of depsMatches) {
      dependencies.push(match[1].trim());
    }
  }

  return {
    name: nameMatch[1],
    version: versionMatch ? versionMatch[1] : '0.0.0',
    dependencies
  };
}

export async function parsePyPiRequirement(
  requirement: string
): Promise<ISpec | null> {
  // Check if it's a GitHub URL
  const gitHubUrlInfo = await parseGitHubUrl(requirement);
  if (gitHubUrlInfo) {
    return {
      package: '', // Will be filled later from GitHub API
      constraints: null,
      isGitHub: true,
      gitHubUrl: requirement,
      gitHubRef: gitHubUrlInfo.ref
    };
  }

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

  const suitablePlatformTags = ['any'];
  if (platform) {
    suitablePlatformTags.push(...PLATFORM_TAGS[platform]);
  }

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
}

function getUnavailableWheelError(
  packageName: string,
  platform: Platform = 'emscripten-wasm32'
) {
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

export async function processRequirement(options: {
  requirement: ISpec;
  pythonVersion: number[];
  warnedPackages?: Set<string>;
  pipSolvedPackages: ISolvedPipPackages;
  installedCondaPackagesNames?: Set<string>;
  installedWheels?: { [name: string]: string };
  installPipPackagesLookup?: ISolvedPipPackages;
  logger?: ILogger;
  required?: boolean;
  platform?: Platform;
}) {
  const {
    requirement,
    pipSolvedPackages,
    pythonVersion,
    logger,
    required,
    platform
  } = options;
  const warnedPackages = options.warnedPackages ?? new Set();
  const installPipPackagesLookup = options.installPipPackagesLookup ?? {};
  const installedWheels = options.installedWheels ?? {};
  const installedCondaPackagesNames =
    options.installedCondaPackagesNames ?? new Set();

  // Handle GitHub URLs
  if (requirement.isGitHub && requirement.gitHubUrl) {
    if (platform === 'emscripten-wasm32') {
      const msg = `Cannot install from GitHub URL '${requirement.gitHubUrl}' on emscripten-wasm32 platform. GitHub packages require building from source which is not supported in WASM environments.`;
      logger?.error(msg);
      throw new Error(msg);
    }

    const gitHubUrlInfo = await parseGitHubUrl(requirement.gitHubUrl);
    if (!gitHubUrlInfo) {
      const msg = `Invalid GitHub URL format: ${requirement.gitHubUrl}`;
      logger?.error(msg);
      throw new Error(msg);
    }

    try {
      const gitHubPackageInfo = await fetchGitHubPackageInfo(
        gitHubUrlInfo.owner,
        gitHubUrlInfo.repo,
        gitHubUrlInfo.ref
      );

      // Update requirement with package name from GitHub
      requirement.package = gitHubPackageInfo.name;

      // Check if already installed via conda
      if (installedCondaPackagesNames.has(requirement.package)) {
        logger?.log(
          `Requirement ${requirement.package} already handled by conda/micromamba/mamba.`
        );
        return;
      }

      // Check if already installed via pip
      const alreadyInstalled = installPipPackagesLookup[requirement.package];
      if (alreadyInstalled) {
        logger?.log(
          `Requirement ${requirement.package} already satisfied with version ${alreadyInstalled.version}.`
        );
        return;
      }

      // Create a "wheel" entry for the GitHub package
      // Use a pseudo-filename for tracking
      const pseudoFilename = `${gitHubPackageInfo.name}-${gitHubPackageInfo.version}-github.whl`;

      // Remove old version if exists
      if (installPipPackagesLookup[requirement.package]) {
        delete pipSolvedPackages[installedWheels[requirement.package]];
        delete installPipPackagesLookup[requirement.package];
        delete installedWheels[requirement.package];
      }

      pipSolvedPackages[pseudoFilename] = {
        name: gitHubPackageInfo.name,
        version: gitHubPackageInfo.version,
        url: requirement.gitHubUrl,
        registry: 'GitHub'
      };
      installedWheels[requirement.package] = pseudoFilename;
      installPipPackagesLookup[requirement.package] =
        pipSolvedPackages[pseudoFilename];

      // Process dependencies
      for (const dep of gitHubPackageInfo.dependencies) {
        const parsedDep = await parsePyPiRequirement(dep);
        if (!parsedDep) {
          continue;
        }

        // Check if dependency is already satisfied
        if (installedCondaPackagesNames.has(parsedDep.package)) {
          if (!warnedPackages.has(parsedDep.package)) {
            logger?.log(`Requirement ${parsedDep.package} already satisfied.`);
          }
          warnedPackages.add(parsedDep.package);
          continue;
        }

        const alreadyInstalledDep = installPipPackagesLookup[parsedDep.package];
        if (
          alreadyInstalledDep &&
          (!parsedDep.constraints ||
            satisfies(alreadyInstalledDep.version, parsedDep.constraints))
        ) {
          if (!warnedPackages.has(parsedDep.package)) {
            logger?.log(
              `Requirement ${parsedDep.package}${parsedDep.constraints || ''} already satisfied.`
            );
          }
          warnedPackages.add(parsedDep.package);
          continue;
        }

        // Recursively process the dependency
        await processRequirement({
          requirement: parsedDep,
          warnedPackages,
          pipSolvedPackages,
          installedCondaPackagesNames,
          installedWheels,
          installPipPackagesLookup,
          logger,
          pythonVersion,
          required: false,
          platform
        });
      }

      return;
    } catch (error: any) {
      const msg = `Failed to resolve GitHub package ${requirement.gitHubUrl}: ${error.message || error}`;
      logger?.error(msg);
      throw new Error(msg);
    }
  }

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

    const parsedRequirement = await parsePyPiRequirement(requirements);
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

    await processRequirement({
      requirement: parsedRequirement,
      warnedPackages,
      pipSolvedPackages,
      installedCondaPackagesNames,
      installedWheels,
      installPipPackagesLookup,
      pythonVersion,
      logger,
      required: false,
      platform
    });
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
    specs = await parsePipPackage(data.pipSpecs);
  } else if (packageNames.length) {
    specs = await parsePipPackage(packageNames);
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

    await processRequirement({
      requirement: spec,
      warnedPackages,
      pipSolvedPackages,
      installedCondaPackagesNames,
      installedWheels,
      installPipPackagesLookup,
      pythonVersion,
      logger,
      required: true,
      platform
    });
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

async function parsePipPackage(pipPackages: Array<string>): Promise<ISpec[]> {
  const specs: ISpec[] = [];
  for (const pipPkg of pipPackages) {
    const parsedSpec = await parsePyPiRequirement(pipPkg);
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

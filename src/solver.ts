import { ILogger, ISolvedPackages } from './helper';
import { parse } from 'yaml';
import { simpleSolve, Platform } from '@baszalmstra/rattler';

export const getSolvedPackages = async (envYml: string, logger?: ILogger) => {
  if (logger) {
    logger.log('Loading solver ...');
  }

  let result: any = undefined;
  let solvedPackages: ISolvedPackages = {};
  const data = parse(envYml);
  const packages = data.dependencies ? data.dependencies : [];
  const specs: string[] = [];
  // Remove pip dependencies which do not impact solving
  for (const pkg of packages) {
    if (typeof pkg === 'string') {
      specs.push(pkg);
    }
  }

  const channels = data.channels ? data.channels : [];
  const platforms: Platform[] = ['noarch', 'emscripten-wasm32'];
  try {
    const startSolveTime = performance.now();
    result = await simpleSolve(specs, channels, platforms);
    const endSolveTime = performance.now();

    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }

    result.map((item: any) => {
      const {
        buildNumber,
        filename,
        packageName,
        repoName,
        url,
        version,
        build
      } = item;
      solvedPackages[filename] = {
        name: packageName,
        repo_url: repoName,
        build_number: buildNumber,
        build_string: build,
        url: url,
        version: version,
        repo_name: repoName
      };
    });
  } catch (error) {
    logger?.error(error);
  }

  return solvedPackages;
};

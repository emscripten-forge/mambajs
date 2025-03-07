import { ILogger, ISolvedPackages } from './helper';
import { parse } from 'yaml';
import { simple_solve } from '@baszalmstra/rattler';

export const getSolvedPackages = async (envYml: string, logger?: ILogger) => {
  if (logger) {
    logger.log('Loading solver ...');
  }

  let result: any = undefined;
  let solvedPackages: ISolvedPackages = {};

  const { specs, channels } = parseEnvYml(envYml);
  const platforms = ['noarch', 'emscripten-wasm32'];
  try {
    const startSolveTime = performance.now();
    result = await simple_solve(specs, channels, platforms);
    const endSolveTime = performance.now();

    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }

    result.map((item: any) => {
      const { build_number, filename, package_name, repo_name, url, version } =
        item;
      solvedPackages[filename] = {
        name: package_name,
        repo_url: repo_name,
        build_number: build_number,
        url: url,
        version: version,
        repo_name: repo_name
      };
    });
  } catch (error) {
    logger?.error(error);
  }

  return solvedPackages;
};

const parseEnvYml = (envYml: string) => {
  const data = parse(envYml);
  const packages = data.dependencies ? data.dependencies : [];
  const prefix = data.name ? data.name : '/';
  const channels = data.channels ? data.channels : [];

  const specs: string[] = [];
  for (const pkg of packages) {
    if (typeof pkg === 'string') {
      specs.push(pkg);
    }
  }
  return { prefix, specs, channels };
};

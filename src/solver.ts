import { ILogger, ISolvedPackages } from './helper';
import { parse } from 'yaml';
import { simple_solve } from "@baszalmstra/rattler";

  export const getSolvedPackages = async (envYml: string, logger?: ILogger) => {
    if (logger) {
      logger.log('Loading solver ...');
    }
  
    const startSolveTime = performance.now();
    let result: any = undefined;
    let solvedPackages:ISolvedPackages = {};
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
    const platforms = [ "noarch","emscripten-wasm32"];
    try {
      result = await simple_solve(
        specs,
        channels,
        platforms
      );
      result.map((item: any)=>{
      const { package_name, repo_name, ...rest } = item; 
      solvedPackages[item.filename] = {
        name: package_name,
        repo_url: repo_name,
        ...rest
    };
    });

    }catch(error){
      logger?.error(error);
    }
    
    const endSolveTime = performance.now();
    if (logger) {
      logger.log(
        `Solving took ${(endSolveTime - startSolveTime) / 1000} seconds`
      );
    }

    return solvedPackages;
  };

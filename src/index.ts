import { FilesData, initUntarJS } from '@emscripten-forge/untarjs';
import {
  fetchJson,
  getPythonVersion,
  IEmpackEnvMetaPkg,
  installCondaPackage
} from './helper';
import { loadDynlibsFromPackage } from './dynload/dynload';

export const bootstrapFromEmpackPackedEnvironment = async (
  packagesJsonUrl: string,
  verbose: boolean = true,
  skipLoadingSharedLibs: boolean = false,
  Module: any,
  pkgRootUrl: string,
  bootstrapPython = false
): Promise<void> => {
  if (verbose) {
    console.log('fetching packages.json from', packagesJsonUrl);
  }

  let empackEnvMeta = await fetchJson(packagesJsonUrl);
  let allPackages: IEmpackEnvMetaPkg[] = empackEnvMeta.packages;
  let prefix = empackEnvMeta.prefix;

  const untarjsReady = initUntarJS();
  const untarjs = await untarjsReady;

  if (allPackages?.length) {
    let sharedLibs = await Promise.all(
      allPackages.map(pkg => {
        const packageUrl = pkg?.url ?? `${pkgRootUrl}/${pkg.filename}`;
        if (verbose) {
          console.log(`Install ${pkg.filename} taken from ${packageUrl}`);
        }
        return installCondaPackage(
          prefix,
          packageUrl,
          Module.FS,
          untarjs,
          verbose
        );
      })
    );
    await waitRunDependencies(Module);
    if (!skipLoadingSharedLibs) {
      await loadShareLibs(allPackages, sharedLibs, prefix, Module);
    }
  }

  if (bootstrapPython) {
    // Assuming these are defined by pyjs
    const pythonVersion = getPythonVersion(allPackages);
    await Module.init_phase_1(prefix, pythonVersion, verbose);
    Module.init_phase_2(prefix, pythonVersion, verbose);
  }
};

const loadShareLibs = (
  packages: IEmpackEnvMetaPkg[],
  sharedLibs: FilesData[],
  prefix: string,
  Module: any
): Promise<void[]> => {
  return Promise.all(
    packages.map(async (pkg, i) => {
      let packageShareLibs = sharedLibs[i];
      if (Object.keys(packageShareLibs).length) {
        let verifiedWasmSharedLibs: FilesData = {};
        Object.keys(packageShareLibs).map(path => {
          const isValidWasm = checkWasmMagicNumber(packageShareLibs[path]);
          if (isValidWasm) {
            verifiedWasmSharedLibs[path] = packageShareLibs[path];
          }
        });
        if (Object.keys(verifiedWasmSharedLibs).length) {
          return await loadDynlibsFromPackage(
            prefix,
            pkg.name,
            false,
            verifiedWasmSharedLibs,
            Module
          );
        }
      }
    })
  );
};

const waitRunDependencies = (Module: any): Promise<void> => {
  const promise = new Promise<void>(r => {
    Module.monitorRunDependencies = n => {
      if (n === 0) {
        r();
      }
    };
  });
  Module.addRunDependency('dummy');
  Module.removeRunDependency('dummy');
  return promise;
};

const checkWasmMagicNumber = (uint8Array: Uint8Array): boolean => {
  const WASM_MAGIC_NUMBER = [0x00, 0x61, 0x73, 0x6d];

  return (
    uint8Array[0] === WASM_MAGIC_NUMBER[0] &&
    uint8Array[1] === WASM_MAGIC_NUMBER[1] &&
    uint8Array[2] === WASM_MAGIC_NUMBER[2] &&
    uint8Array[3] === WASM_MAGIC_NUMBER[3]
  );
};

export default {
  installCondaPackage,
  bootstrapFromEmpackPackedEnvironment
};

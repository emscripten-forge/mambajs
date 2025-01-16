import { FilesData, initUntarJS } from '@emscripten-forge/untarjs';
import {
  bootstrapPythonPackage,
  fetchJson,
  IEmpackEnvMetaPkg,
  installCondaPackage,
  IPackagesInfo
} from './helper';
import { loadDynlibsFromPackage } from './dynload/dynload';

const splitPackages = (packages: IEmpackEnvMetaPkg[]): IPackagesInfo => {
  let pythonPackage: IEmpackEnvMetaPkg | undefined = undefined;
  for (let i = 0; i < packages.length; i++) {
    if (packages[i].name == 'python') {
      pythonPackage = packages[i];
      packages.splice(i, 1);
      break;
    }
  }
  if (pythonPackage) {
    let pythonVersion = pythonPackage.version.split('.').map(x => parseInt(x));
    return { pythonPackage, pythonVersion, packages };
  } else {
    return { packages };
  }
};

export const bootstrapFromEmpackPackedEnvironment = async (
  packagesJsonUrl: string,
  verbose: boolean = true,
  skipLoadingSharedLibs: boolean = false,
  Module: any,
  pkgRootUrl: string,
  bootstrapPython = false
): Promise<IPackagesInfo> => {
  if (verbose) {
    console.log('fetching packages.json from', packagesJsonUrl);
  }

  let empackEnvMeta = await fetchJson(packagesJsonUrl);
  let allPackages: IEmpackEnvMetaPkg[] = empackEnvMeta.packages;
  let prefix = empackEnvMeta.prefix;
  let { pythonPackage, pythonVersion, packages } = splitPackages(allPackages);
  let packagesData = { prefix, pythonVersion };

  const untarjsReady = initUntarJS();
  const untarjs = await untarjsReady;

  if (bootstrapPython && pythonPackage && pythonVersion) {
    await bootstrapPythonPackage(
      pythonPackage,
      pythonVersion,
      verbose,
      untarjs,
      Module,
      pkgRootUrl,
      prefix
    );
  }

  if (packages?.length) {
    let sharedLibs = await Promise.all(
      packages.map(pkg => {
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
      await loadShareLibs(packages, sharedLibs, prefix, Module);
    }
  }

  if (bootstrapPython && pythonPackage && pythonVersion) {
    globalThis.Module.init_phase_2(prefix, pythonVersion, verbose);
  }

  return packagesData;
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

## Mambajs

Installing conda packages into a browser

## Using

This package has 2 methods:
- `installCondaPackage(prefix, url, Module.FS, untarjs, verbose)` - downloading one conda package and saving it into a browser. It returns shared libs if a package has them.

- `bootstrapFromEmpackPackedEnvironment( packagesJsonUrl, verbose, skipLoadingSharedLibs,Module, pkgRootUrl)` - downloading empack_env_meta.json and installing all conda packages from this file.

The example of using:

```ts
import {
  bootstrapFromEmpackPackedEnvironment,
  IPackagesInfo
} from '@emscripten-forge/mambajs';

 const packagesJsonUrl = `http://localhost:8888/empack_env_meta.json`;
 const pkgRootUrl = 'kernel/kernel_packages';
 cosnt verbose = true;

 let packageData: IPackagesInfo = {};
 packageData = await bootstrapFromEmpackPackedEnvironment(
    packagesJsonUrl,
    verbose,
    false,
    Module,
    pkgRootUrl
);

```

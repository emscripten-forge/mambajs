import core, { ICorePicomamba } from './core';
import coreWasm from './core.wasm';

export * as coreWasm from './core.wasm';

export async function initializeWasm(
  locateWasm?: (file: string) => string
): Promise<ICorePicomamba> {
  const wasmModule: ICorePicomamba = await core({
    locateFile(path: string) {
      if (path.endsWith('.wasm')) {
        if (locateWasm) {
          return locateWasm(path);
        }
        return coreWasm;
      }

      return path;
    }
  });

  return wasmModule;
}

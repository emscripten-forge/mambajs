import core, { ICorePicomamba } from './core';
import coreWasm from './core.wasm';

const initializeWasm = async (): Promise<ICorePicomamba> => {
  const wasmModule: ICorePicomamba = await core({
    locateFile(path: string) {
      if (path.endsWith('.wasm')) {
          return coreWasm;
      }

      return path;
    }
  });

  return wasmModule;
};

export default initializeWasm;

import core, { ICorePicomamba } from './core';
import coreWasm from './core.wasm';

const initializeWasm = async (): Promise<ICorePicomamba> => {
  const wasmModule: ICorePicomamba = await core({
    locateFile(path: string) {
      if (path.endsWith('.wasm')) {
        return (new URL(coreWasm, import.meta.url)).href;
      }

      return path;
    }
  });

  return wasmModule;
};

export default initializeWasm;

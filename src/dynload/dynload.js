const memoize = (fn) => {
    let cache = {};
    return (...args) => {
        let n = args[0];
        if (n in cache) {
            return cache[n];
        } else {
            let result = fn(n);
            cache[n] = result;
            return result;
        }
    };
};


function createLock() {
    let _lock = Promise.resolve();

    async function acquireLock() {
        const old_lock = _lock;
        let releaseLock = () => { };
        _lock = new Promise((resolve) => (releaseLock = resolve));
        await old_lock;
        return releaseLock;
    }
    return acquireLock;
}

function isInSharedLibraryPath(prefix, libPath){
    if (libPath.startsWith("/")){
        const dirname = libPath.substring(0, libPath.lastIndexOf("/"));
        if(prefix == "/"){
            return (dirname == `/lib`);
        }
        else{
          return (dirname == `${prefix}/lib`);
        }
    }
    else{
        return false;
    }
}

export async function loadDynlibsFromPackage(
    prefix,
    pkg_file_name,
    pkg_is_shared_library,
    dynlibPaths,
    Module
  ) {
console.log('dynlibPaths',dynlibPaths);
    // assume that shared libraries of a package are located in <package-name>.libs directory,
    // following the convention of auditwheel.
    if(prefix == "/"){
        var sitepackages = `/lib/python3.11/site-packages`
    }
    else{
        var sitepackages = `${prefix}/lib/python3.11/site-packages`
    }
    const auditWheelLibDir = `${sitepackages}/${
        pkg_file_name.split("-")[0]
    }.libs`;

    // This prevents from reading large libraries multiple times.
    const readFileMemoized = memoize(Module.FS.readFile);
    const forceGlobal = !!pkg_is_shared_library;



    let dynlibs = [];


    if (forceGlobal) {
      dynlibs = Object.keys(dynlibPaths).map((path) =>{
        return {
          path: path,
          global: true,
        };
      });
    } else {
      const globalLibs = calculateGlobalLibs(
        dynlibPaths,
        readFileMemoized,
        Module
      );

      dynlibs = Object.keys(dynlibPaths).map((path) =>{
        const global = globalLibs.has(Module.PATH.basename(path));
        return {
          path: path,
          global: global || !! pkg_is_shared_library || isInSharedLibraryPath(prefix, path) || path.startsWith(auditWheelLibDir),
        };
      });
    }

console.log('dynlibs',dynlibs);
    dynlibs.sort((lib1, lib2) => Number(lib2.global) - Number(lib1.global));
    for (const { path, global } of dynlibs) {

      await loadDynlib(prefix, path, global, [auditWheelLibDir], readFileMemoized, Module);
    }
  }

function createDynlibFS(
    prefix,
    lib,
    searchDirs,
    readFileFunc,
    Module
) {

    const dirname = lib.substring(0, lib.lastIndexOf("/"));
    let _searchDirs = searchDirs || [];

    if(prefix == "/"){
        _searchDirs = _searchDirs.concat([dirname], [`/lib`]);
    }
    else{
        _searchDirs = _searchDirs.concat([dirname], [`${prefix}/lib`]);
    }

    const resolvePath = (path) => {

        if (Module.PATH.basename(path) !== Module.PATH.basename(lib)) {
            //console.debug(`Searching a library from ${path}, required by ${lib}`);
        }

        for (const dir of _searchDirs) {
            const fullPath = Module.PATH.join2(dir, path);
            //console.log('createDynlibFS: fullPath',fullPath);
            if (Module.FS.findObject(fullPath) !== null) {
                return fullPath;
            }
        }
        return path;
    };

    let readFile = (path) =>
        Module.FS.readFile(resolvePath(path));

    if (readFileFunc !== undefined) {
        readFile = (path) => readFileFunc(resolvePath(path));
    }

    const fs = {
        findObject: (path, dontResolveLastLink) => {
            let obj = Module.FS.findObject(resolvePath(path), dontResolveLastLink);

            if (obj === null) {
                console.debug(`Failed to find a library: ${resolvePath(path)}`);
            }

            return obj;
        },
        readFile: readFile,
    };

    return fs;
}


function calculateGlobalLibs(
    libs,
    readFileFunc,
    Module
) {

    let readFile = Module.FS.readFile;
    if (readFileFunc !== undefined) {
        readFile = readFileFunc;
    }

    const globalLibs = new Set();

    Object.keys(libs).map((lib) => {

        if (!Module.FS.analyzePath(`${lib}`).exists) {
            console.log('lib path does not exist');
          } else {
            console.log('it is exist');
          }

        const binary = readFile(lib);
        console.log('binary', binary);
        const needed = Module.getDylinkMetadata(binary).neededDynlibs;
        console.log('needed',needed);
        needed.forEach((lib) => {
            globalLibs.add(lib);
        });
    });
    console.log('globalLibs', globalLibs);
    return globalLibs;
}


// Emscripten has a lock in the corresponding code in library_browser.js. I
// don't know why we need it, but quite possibly bad stuff will happen without
// it.
const acquireDynlibLock = createLock();


async function loadDynlib(prefix, lib, global, searchDirs, readFileFunc, Module) {
    if (searchDirs === undefined) {
        searchDirs = [];
    }
 
    const releaseDynlibLock = await acquireDynlibLock();
    
    console.log('loadDynlib');
    try {
        const fs = createDynlibFS(prefix, lib, searchDirs, readFileFunc, Module);

        const libName = Module.PATH.basename(lib);
        console.log('libName', libName);
        await Module.loadDynamicLibrary(libName, {
            loadAsync: true,
            nodelete: true,
            allowUndefined: true,
            global: global,
            fs: fs
        })
        console.log('---LDSO---');
        console.log('libName',libName);
        const dsoOnlyLibName = Module.LDSO.loadedLibsByName[libName];
        console.log('dsoOnlyLibName',dsoOnlyLibName);
        console.log('lib',lib);
        const dsoFullLib = Module.LDSO.loadedLibsByName[lib];
        console.log('dsoFullLib',dsoFullLib);
        if(!dsoOnlyLibName && !dsoFullLib){
            console.execption(`Failed to load ${libName} from ${lib} LDSO not found`);
        }

        if (!dsoOnlyLibName) {
            console.log('!dsoOnlyLibName');
            Module.LDSO.loadedLibsByName[libName] = dsoFullLib
        }

        if(!dsoFullLib){
            console.log('!dsoFullLib');
            Module.LDSO.loadedLibsByName[lib] = dsoOnlyLibName;
        }
    } catch(error) {
        console.error(error);
    }finally {
        releaseDynlibLock();
    }
}

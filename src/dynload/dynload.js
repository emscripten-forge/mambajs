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
            console.log('dirname 1',dirname);
            return (dirname == `/lib`);
        }
        else{
          console.log('dirname 2',dirname);
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


    console.log('auditWheelLibDir',auditWheelLibDir);
    // This prevents from reading large libraries multiple times.
    const readFileMemoized = memoize(Module.FS.readFile);
console.log('readFileMemoized',readFileMemoized);
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
if (Module.PATH) {
    console.log('+++');
}
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
        console.log(' dynlibs.sort: path -  ', path);
        console.log(' dynlibs.sort: global', global);

      await loadDynlib(prefix, path, global, [auditWheelLibDir], readFileMemoized);
    }
  }

function createDynlibFS(
    prefix,
    lib,
    searchDirs,
    readFileFunc,
    Module
) {

    console.log('createDynlibFS');
    const dirname = lib.substring(0, lib.lastIndexOf("/"));
    console.log('createDynlibFS: dirname',dirname);
    let _searchDirs = searchDirs || [];

    if(prefix == "/"){
        _searchDirs = _searchDirs.concat([dirname], [`/lib`]);
    }
    else{
        _searchDirs = _searchDirs.concat([dirname], [`${prefix}/lib`]);
    }
    console.log('createDynlibFS: _searchDirs',_searchDirs);

    const resolvePath = (path) => {

        if (Module.PATH.basename(path) !== Module.PATH.basename(lib)) {
            //console.debug(`Searching a library from ${path}, required by ${lib}`);
        }

        for (const dir of _searchDirs) {
            const fullPath = Module.PATH.join2(dir, path);
            console.log('createDynlibFS: fullPath',fullPath);
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

    console.log('libs',libs);
    let readFile = Module.FS.readFile;
    console.log('calculateGlobalLibs readFiles');
    if (readFileFunc !== undefined) {
        readFile = readFileFunc;
    }

    const globalLibs = new Set();

    Object.keys(libs).map((lib) => {
        console.log('through lib');
        const binary = readFile(lib);
        console.log('binary');
        const needed = Module.getDylinkMetadata(binary).neededDynlibs;
        console.log('needed',needed);
        needed.forEach((lib) => {
            globalLibs.add(lib);
        });
    });

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
    try {
    const releaseDynlibLock = await acquireDynlibLock();
    } catch(error) {
console.error(error);
    };
    

    try {
        console.log('createDynlibFS')
        const fs = createDynlibFS(prefix, lib, searchDirs, readFileFunc);

        const libName = Module.PATH.basename(lib);
        console.log('libName', libName);
        console.log('lib', lib)

        await Module.loadDynamicLibrary(libName, {
            loadAsync: true,
            nodelete: true,
            allowUndefined: true,
            global: global,
            fs: fs
        })

        const dsoOnlyLibName = Module.LDSO.loadedLibsByName[libName];
        console.log('dsoOnlyLibName',dsoOnlyLibName);
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

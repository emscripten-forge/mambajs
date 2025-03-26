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
    pkgName,
    dynlibPaths,
    Module
  ) {
    // assume that shared libraries of a package are located in <package-name>.libs directory,
    // following the convention of auditwheel.
    if(prefix == "/"){
        var sitepackages = `/lib/python3.11/site-packages`
    }
    else{
        var sitepackages = `${prefix}/lib/python3.11/site-packages`
    }
    const auditWheelLibDir = `${sitepackages}/${pkgName}.libs`;

    // This prevents from reading large libraries multiple times.
    const readFileMemoized = memoize(Module.FS.readFile);

    let dynlibs = [];

    const globalLibs = calculateGlobalLibs(
        dynlibPaths,
        readFileMemoized,
        Module
    );

    dynlibs = dynlibPaths.map((path) =>{
        const global = globalLibs.has(Module.PATH.basename(path));
        return {
            path: path,
            global: global || isInSharedLibraryPath(prefix, path) || path.startsWith(auditWheelLibDir),
        };
    });

    dynlibs.sort((lib1, lib2) => Number(lib2.global) - Number(lib1.global));
    for (const { path, global } of dynlibs) {
        try {
            await loadDynlib(prefix, path, global, [auditWheelLibDir], readFileMemoized, Module);
        } catch(e) {
            // Not preventing the loop to continue
            console.error(`Failed to load dynlib ${path}`, e);
        }
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
        }

        for (const dir of _searchDirs) {
            const fullPath = Module.PATH.join2(dir, path);
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

    libs.map((lib) => {
        const binary = readFile(lib);
        const needed = Module.getDylinkMetadata(binary).neededDynlibs;
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

    const releaseDynlibLock = await acquireDynlibLock();

    try {
        const fs = createDynlibFS(prefix, lib, searchDirs, readFileFunc, Module);

        const libName = Module.PATH.basename(lib);

        // contains cpython-3 and with wasm32-emscripten
        const is_cython_lib = libName.includes("cpython-3") && libName.includes("wasm32-emscripten");

        // load cython library from full path
        const load_name = is_cython_lib ? lib : libName;

        await Module.loadDynamicLibrary(load_name, {
            loadAsync: true,
            nodelete: true,
            allowUndefined: true,
            global: global && !is_cython_lib,
            fs: fs
        })
        const dsoOnlyLibName = Module.LDSO.loadedLibsByName[libName];
        const dsoFullLib = Module.LDSO.loadedLibsByName[lib];
        if(!dsoOnlyLibName && !dsoFullLib){
            console.execption(`Failed to load ${libName} from ${lib} LDSO not found`);
        }

        if(!is_cython_lib){
            if (!dsoOnlyLibName) {
                Module.LDSO.loadedLibsByName[libName] = dsoFullLib
            }

            if(!dsoFullLib){
                Module.LDSO.loadedLibsByName[lib] = dsoOnlyLibName;
            }
        }
    } catch(error) {
        throw new Error(error?.message);
    }finally {
        releaseDynlibLock();
    }
}

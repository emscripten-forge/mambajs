#!/bin/bash

set -e

THIS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
ENV_FOLDER=$THIS_DIR/wasm-picomamba
LIBS_FOLDER=$THIS_DIR/libs
WASM_LIB="lib"

if [ -d "$ENV_FOLDER" ]; then
    echo "Folder '$ENV_FOLDER' already exists."
else
    echo "Folder '$ENV_FOLDER' does not exist. Creating it now..."
    mkdir "$ENV_FOLDER"
    echo "Folder '$ENV_FOLDER' created."
fi

if [ -d "$LIBS_FOLDER" ]; then
    echo "Folder '$LIBS_FOLDER' already exists."
else
    echo "Folder '$LIBS_FOLDER' does not exist. Creating it now..."
    mkdir "$LIBS_FOLDER"
    echo "Folder '$LIBS_FOLDER' created."
fi

PREFIX_DIR=$THIS_DIR/wasm-picomamba
EMSDK_DIR=$THIS_DIR/libs/emsdk
PREFIX=$PREFIX_DIR

if [ -z "$MAMBA_EXE" ]; then
    echo "Error: MAMBA_EXE environment variable is not set."
    exit 1
fi

cd $THIS_DIR

rm -rf $PREFIX_DIR

echo "Start of compiling emscripten-forge"

if [ ! -d "$EMSDK_DIR" ]; then
    echo "Cloning emsdk repository..."
    cd $LIBS_FOLDER
    git clone https://github.com/emscripten-core/emsdk.git
    cd $EMSDK_DIR
    ./emsdk install "3.1.45"
    ./emsdk activate "3.1.45"
    cd ..
else
    echo "$EMSDK_DIR directory already exists. Skipping clone."
fi

source $EMSDK_DIR/emsdk_env.sh
echo "Finish of compiling emscripten-forge"

if true; then
    echo "Creating wasm env at $PREFIX_DIR"
    $MAMBA_EXE create -p $PREFIX_DIR \
            --platform=emscripten-wasm32 \
            -c https://repo.prefix.dev/emscripten-forge-dev \
            -c https://repo.prefix.dev/conda-forge \
            --yes \
            libsolv nlohmann_json
fi

export PREFIX=$PREFIX_DIR
export CPPFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"

cd $THIS_DIR

echo "Start of compiling core.cpp"

if [ -d "$WASM_LIB" ]; then
    echo "Folder '$WASM_LIB' already exists."
else
    echo "Folder '$WASM_LIB' does not exist. Creating it now..."
    mkdir "$WASM_LIB"
    echo "Folder '$WASM_LIB' created."
fi

emcc core.cpp -o $WASM_LIB/core.js \
    $CPPFLAGS $LDFLAGS \
    ${PREFIX}/lib/libsolv.a \
    ${PREFIX}/lib/libsolvext.a \
    -lembind \
    -s MODULARIZE=1 -s WASM=1 -O3 -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=128mb \
    -s ENVIRONMENT=web \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "FS"]' \
    -s EXPORTED_FUNCTIONS="['_malloc', '_free']"

echo "Build completed successfully!"

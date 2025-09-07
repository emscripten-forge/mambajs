import { SharedMem, SharedMemMain, SharedMemFile } from './squashfshelper';
import { PromiseDelegate } from '@lumino/coreutils';

console.log('Start squashfs worker');

function mayConcatUint8Arrays(arrays: Uint8Array[]) {
  if (arrays.length === 1) return arrays[0];
  let totalLength = arrays.reduce((acc, array) => acc + array.byteLength, 0);
  let result = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.byteLength;
  }
  return result;
}

console.log('worker mark1');

type FetchBlock = {
  reads?: Uint8Array[];
  proms?: Promise<void>[];
};

class SquashFileFetcher {
  constructor(url: string | URL) {
    this.url_ = url;
    this.initFileSize();
  }

  private async initFileSize() {
    // First determine and set FileSize (inspired from emscripten wasmfs fetch, so portions used)
    try {
      const fileInfo = await fetch(this.url_, {
        method: 'HEAD',
        headers: { Range: 'bytes=0-' }
      });
      if (fileInfo.ok && fileInfo.headers.get('Content-Length')) {
        const fileSize = parseInt(
          fileInfo.headers.get('Content-Length') || '0',
          10
        );

        if (fileInfo.headers.get('Accept-Ranges') === 'bytes') {
          await this.readFirstSector(false, fileSize);
        } else {
          await this.readFirstSector(true, fileSize); // we need to do a full read.
        }
      } else {
        this.fullFile_ = true;
        await this.readFirstSector(false, undefined); // we need to do a full read.
      }
    } catch (error) {
      if (typeof this.fileSize_ === 'object' && 'promise' in this.fileSize_)
        this.fileSize_.reject(error);
    }
  }

  private async readFirstSector(fullFile: boolean, fileSize?: number) {
    const fetchOpts: { headers?: { [key: string]: string } } = {};
    if (!fullFile) {
      fetchOpts.headers = { Range: `bytes=0-4095` }; // minimal sector size
    }
    const response = await fetch(this.url_, fetchOpts);
    if (!response.ok) {
      throw new Error('Fetch error, reponse status not ok');
    }
    const stream = response.body;
    if (!stream) {
      throw new Error('Fetch error, no body stream');
    }
    const reader = stream.getReader(); // should we use a byob ?
    const { value, done } = await reader.read();
    if (!value || value.byteLength < 72 || done) {
      throw new Error('Fetch error, first body read failed');
    }
    const headerDv = new DataView(value.buffer);
    const blockSize = headerDv.getUint32(12, true);
    const bytesUsed = headerDv.getBigUint64(40, true);
    if (fileSize && bytesUsed > BigInt(fileSize)) {
      throw new Error('Fetch error, bytesUsed > as fileSize');
    }

    // got it now init
    const blockNum = fileSize
      ? fileSize / blockSize
      : Math.ceil(Number(bytesUsed / BigInt(blockSize)));
    const blocks = this.blocks_;
    for (let block = 1; block < blockNum; block++) {
      blocks[block] = {};
    }
    fileSize = fileSize || blockSize * blockNum;

    if (typeof this.fileSize_ === 'object' && 'promise' in this.fileSize_) {
      const delegate = this.fileSize_;
      this.fileSize_ = fileSize;
      delegate.resolve(fileSize);
    } else {
      this.fileSize_ = fileSize;
    }
    if (typeof this.blockSize_ === 'object' && 'promise' in this.blockSize_) {
      const delegate = this.blockSize_;
      this.blockSize_ = blockSize;
      delegate.resolve(blockSize);
    } else {
      this.blockSize_ = blockSize;
    }

    await this.storeRead(0n, value);
    this.contineReading(BigInt(value.byteLength), reader); // we are not awaiting this
  }

  private async contineReading(
    offset: bigint,
    reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>
  ) {
    try {
      let curoffset = offset;
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          await this.storeRead(curoffset, value);
          curoffset += BigInt(value.byteLength);
        }
        if (done) break;
      }
      reader.releaseLock();
    } catch (error) {
      console.log('Problem in continue reading:', error);
    }
  }

  async readRequestBlockRange(
    blockstart: number,
    blockend: number /*inclusive*/
  ) {
    let curreadStart: undefined | number = undefined;
    let curreadEnd: undefined | number = undefined;
    for (let block = blockstart; block <= blockend; block++) {
      if (
        (typeof this.blocks_[block].reads === 'undefined' ||
          (block === 0 &&
            this.blocks_[0]?.reads?.length == 1 &&
            this.blocks_[0].reads[0].byteLength !== this.blockSize_)) &&
        !curreadStart
      ) {
        if (!curreadStart) {
          curreadStart = block;
        }
        curreadEnd = block;
      } else {
        if (curreadStart && curreadEnd) {
          // commit
          const readProm = this.readBlockRange(curreadStart, curreadEnd);
          this.blocks_.slice(curreadStart, curreadEnd + 1).forEach(curblock => {
            curblock.proms ||= [];
            curblock.proms.push(readProm);
          });
          curreadStart = curreadEnd = undefined;
        }
      }
    }
  }

  async getBlock(number): Promise<Uint8Array<ArrayBufferLike> | undefined> {
    const block = this.blocks_[number];
    if (typeof block === 'undefined') throw new Error('Unknown block');
    if (typeof block.proms !== 'undefined') {
      await Promise.all(block.proms);
      delete block.proms;
    }
    if (typeof block.reads === 'undefined') {
      return undefined;
    }
    const joined = mayConcatUint8Arrays(block.reads);
    if (typeof joined !== 'undefined') block.reads = [joined];
    return joined;
  }

  private async readBlockRange(
    blockstart: number,
    blockend: number /*inclusive*/
  ) {
    if (this.fullFile_)
      throw new Error('readBlockRange is not available for full file');
    const blockSize =
      typeof this.blockSize_ === 'object'
        ? await this.blockSize_?.promise
        : this.blockSize_;
    let rangeStart = blockstart * blockSize;
    let rangeEnd = (blockend + 1) * blockSize - 1;
    if (blockstart === 0 && this.blocks_[0]?.reads?.length === 1) {
      rangeStart += this.blocks_[0]?.reads[0].byteLength;
    }
    const response = await fetch(this.url_, {
      headers: { Range: 'bytes=' + rangeStart + '-' + rangeEnd }
    });
    if (!response.ok) {
      throw new Error('Fetch error, reponse status not ok');
    }
    const stream = response.body;
    if (!stream) {
      throw new Error('Fetch error, no body stream');
    }
    await this.contineReading(BigInt(rangeStart), stream.getReader());
  }

  private async storeRead(offset: bigint, read: Uint8Array) {
    let curoffset = offset;
    let curread = read;
    const blockSize =
      typeof this.blockSize_ === 'object'
        ? await this.blockSize_?.promise
        : this.blockSize_;
    const firstBlock = Number(offset / BigInt(blockSize));
    const lastBlock =
      (offset + BigInt(read.byteLength) - 1n) / BigInt(blockSize);
    for (let blocknum = firstBlock; blocknum <= lastBlock; blocknum++) {
      const block = this.blocks_[blocknum];
      let calcoffset = 0;
      if (block.reads) {
        calcoffset = block.reads.reduce(
          (accumulator, currentValue) => accumulator + currentValue.byteLength,
          0
        );
        if (
          BigInt(calcoffset) !=
          curoffset - BigInt(blocknum) * BigInt(blockSize)
        )
          throw new Error(
            'Wrong offset ' +
              calcoffset +
              ':' +
              (curoffset - BigInt(blocknum) * BigInt(blockSize))
          );
      }
      if (calcoffset + curread.byteLength > blockSize) {
        block.reads ||= [];
        block.reads.push(
          new Uint8Array(
            curread.buffer,
            curread.byteOffset,
            blockSize - calcoffset
          )
        );
        curread = new Uint8Array(
          curread.buffer,
          curread.byteOffset + blockSize - calcoffset,
          curread.byteLength - blockSize + calcoffset
        );
      }
    }
  }

  get fileSize() {
    if (typeof this.fileSize_ === 'object' && 'promise' in this.fileSize_!)
      return this.fileSize_.promise;
    return this.fileSize_;
  }

  get blockSize() {
    if (typeof this.blockSize_ === 'object' && 'promise' in this.blockSize_!)
      return this.blockSize_.promise;
    return this.blockSize_;
  }

  private url_: string | URL;
  private fileSize_: number | PromiseDelegate<number> =
    new PromiseDelegate<number>();
  private blockSize_: number | PromiseDelegate<number> =
    new PromiseDelegate<number>();
  private blocks_: [FetchBlock, ...FetchBlock[]] = [{}];
  private fullFile_ = false;
}

console.log('worker mark2');

let sharedMem: SharedMem | undefined;
let sharedMemMain: SharedMemMain | undefined;

const sharedMemFiles: {
  [key: string]: { sharedMemFile: SharedMemFile; fetcher: SquashFileFetcher };
} = {};

const fetchLoop = async () => {
  console.log('worker mark fetch');
  if (typeof sharedMemMain === 'undefined')
    throw new Error('sharedMemMain not set before fetchLoop');
  while (true) {
    try {
      await sharedMemMain.waitNextFileIdToGet();
      const nextFileIdToGet = sharedMemMain.nextFileIdToGet;
      sharedMemMain.nextFileIdToGet = 0;
      const file = sharedMemFiles[nextFileIdToGet];
      if (file) {
        const memFile = file.sharedMemFile;
        const fetcher = file.fetcher;
        // now we need to decide the next task
        if (memFile.fileSize === 0) {
          // fileSize is missing, do initial info stuff
          console.log('wloop mark 1');
          memFile.fileSize = await fetcher.fileSize;
          console.log('wloop mark 2');

          // Then determine and set chunksize
          memFile.chunkSize = await fetcher.blockSize;
          console.log('wloop mark 3');
          await memFile.waitChunksSet();
          console.log('wloop mark 4');
        } else {
          // init done now initiate the data fetch
          const startChunk = memFile.triggerChunkStart;
          const endChunk = memFile.triggerChunkStart;
          // reset
          memFile.triggerChunkStart = memFile.triggerChunkEnd = 0;
          await fetcher.readRequestBlockRange(startChunk, endChunk);
          for (let chunk = startChunk; chunk <= endChunk; chunk++) {
            console.log('wloop mark 5');
            const blockdata = await fetcher.getBlock(chunk); // get the block after fetching
            console.log('wloop mark 6');
            const memchunk = memFile.getChunk(chunk);
            const memdata = memchunk.data;
            if (typeof memdata === 'undefined')
              throw new Error('Data not set in memchunk');
            if (typeof blockdata === 'undefined')
              throw new Error('Blockdata not returned');

            memdata.set(blockdata);
            memchunk.read = blockdata.byteLength;
          }
        }
      }
    } catch (error) {
      console.log('fetchLoop error:', error);
    }
  }
};

globalThis.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;

  console.log('worker message', event);
  switch (message.task) {
    case 'init':
      {
        console.log('Init sqfs worker');
        const heap = message.heap;
        const sharedMemMainPtr = message.sharedMemMain;
        if (sharedMem) {
          throw new Error('Worker is already inited!');
        }
        sharedMem = new SharedMem(heap);
        sharedMemMain = new SharedMemMain(sharedMem, sharedMemMainPtr);
        try {
          fetchLoop().catch(error =>
            console.log('Error launching main:', error)
          );
        } catch (error) {
          console.log('fetchLoop error', error);
        }
        globalThis.postMessage({ inited: true });
      }
      break;
    case 'addFile':
      {
        const sharedMemFilePtr = message.sharedMemFile;
        if (typeof sharedMem === 'undefined')
          throw new Error('addFile before init');
        const sharedMemFile = new SharedMemFile(sharedMem, sharedMemFilePtr);
        sharedMemFiles[sharedMemFile.fileId] = {
          sharedMemFile,
          fetcher: new SquashFileFetcher(message.url)
        };
        globalThis.postMessage({ messageid: message.messid_ });
      }
      break;
  }
});

globalThis.postMessage({ started: true });

console.log('worker end');

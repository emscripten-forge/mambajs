
export class SharedMem {
  constructor(heap: ArrayBufferLike) {
    this.heap_ = heap;
    this.heapU8_ = new Uint8Array(heap);
    this.heapI32_ = new Int32Array(heap);
  }

  get heap(){
    return this.heap_;
  }

  get heapU8(){
    return this.heapU8_;
  }

  get heapI32(){
    return this.heapI32_;
  }

  private heap_: ArrayBufferLike;
  private heapU8_: Uint8Array;
  private heapI32_: Int32Array;
}

class SharedMemBase {
  constructor(mem: SharedMem, mempointer: number, size: number) {
    this.mem_ = mem;
    this.dataview_ = new DataView(this.mem_.heap, mempointer, size);
    this.pointer_ = mempointer;
  }

  protected async waitAsync(location, expect) {
    const { value, async } = Atomics.waitAsync(
      this.mem_.heapI32,
      (this.pointer_ + location) / 4,
      expect
    );
    if (async) {
      await value;
    }
  }

  get ptr(): number {
    return this.pointer_;
  }

  protected pointer_: number;
  protected mem_: SharedMem;
  protected dataview_: DataView;
}

export class SharedMemMain extends SharedMemBase {
  private static memSize = 5; // FIX ME: 64 Bit pointer

  constructor(mem: SharedMem, mempointer: number) {
    super(mem, mempointer, SharedMemMain.memSize);
  }

  async waitNextFileIdToGet() {
    await this.waitAsync(0 /* position of nextFileId */, 0);
  }

  get nextFileIdToGet(): number {
    return this.dataview_.getUint32(0, true);
  }

  set nextFileIdToGet(newVal: number) {
    this.dataview_.setUint32(0, newVal, true);
  }

  get crossOriginIsolated(): boolean {
    return !!this.dataview_.getUint8(4);
  }

  set crossOriginIsolated(newVal: boolean) {
    this.dataview_.setUint8(4, newVal ? 1 : 0);
  }
}

class SharedMemChunk extends SharedMemBase {
  private static memSize = 3* 4; // FIX ME: 64 Bit pointer

  constructor(mem: SharedMem, mempointer: number, chunkSize: number) {
    super(mem, mempointer, SharedMemChunk.memSize);
    this.chunkSize_ = chunkSize;
  }

  get read(): number {
    return this.dataview_.getUint32(0, true);
  }

  set read(newVal: number) {
    Atomics.store(this.mem_.heapI32, (this.pointer_ + 0) / 4, newVal);
    Atomics.notify(this.mem_.heapI32, (this.pointer_ + 0) / 4);
  }

  get trigger(): number {
    return this.dataview_.getUint32(4, true);
  }

  get data(): Uint8Array | undefined {
    const dataPointer = this.dataview_.getUint32(8, true);
    if (dataPointer === 0) {
      return undefined;
    }
    return new Uint8Array(this.mem_.heap, dataPointer, this.chunkSize_);
  }
  private chunkSize_: number;
}

export class SharedMemFile extends SharedMemBase {
  static memSize = 7 * 4; // FIX ME: 64 Bit pointer

  constructor(mem: SharedMem, mempointer: number) {
    super(mem, mempointer, SharedMemFile.memSize);
  }

  async waitChunksSet() {
    await this.waitAsync(6 * 4 /* position of chunks */, 0);
  }

  get fileSize(): number {
    return this.dataview_.getUint32(0, true);
  }

  set fileSize(newVal: number) {
    Atomics.store(this.mem_.heapI32, (this.pointer_ + 0) / 4, newVal);
    Atomics.notify(this.mem_.heapI32, (this.pointer_ + 0) / 4);
  }

  get fileId(): number {
    return this.dataview_.getUint32(4, true);
  }

  set fileId(newVal: number) {
    this.dataview_.setUint32(4, newVal, true);
  }

  get chunkSize(): number {
    return this.dataview_.getUint32(8, true);
  }

  set chunkSize(newVal: number) {
    // Use Atomics.store and Atomics.notify for mutex functionality
    Atomics.store(this.mem_.heapI32, (this.pointer_ + 8) / 4, newVal);
    Atomics.notify(this.mem_.heapI32, (this.pointer_ + 8) / 4);
  }

  get triggerChunkStart(): number {
    return this.dataview_.getUint32(12, true);
  }

  set triggerChunkStart(newVal: number) {
    this.dataview_.setUint32(12, newVal, true);
  }

  get triggerChunkEnd(): number {
    return this.dataview_.getUint32(16, true);
  }

  set triggerChunkEnd(newVal: number) {
    this.dataview_.setUint32(16, newVal, true);
  }

  get mainStruct(): SharedMemMain {
    const pointer = this.dataview_.getUint32(20, true);
    return new SharedMemMain(this.mem_, pointer)
  }

  set mainStruct(main: SharedMemMain) {
    this.dataview_.setUint32(20, main.ptr, true);
  }

  getChunk(index: number): SharedMemChunk {
    const chunkPointer = this.dataview_.getUint32(24, true) + (index * 12); // Each chunk is 12 bytes (4+4+4)
    const chunkSize = this.dataview_.getUint32(8, true);
    return new SharedMemChunk(this.mem_, chunkPointer, chunkSize);
  }
}





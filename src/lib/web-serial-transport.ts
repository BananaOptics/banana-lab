export type SerialLogLevel = "info" | "rx" | "tx" | "warning" | "error";

export interface SerialLogEntry {
  level: SerialLogLevel;
  message: string;
  bytes?: Uint8Array;
}

type QueueWaiter = () => void;

export class ByteQueue {
  private bytes: number[] = [];
  private waiters: QueueWaiter[] = [];

  get length() {
    return this.bytes.length;
  }

  push(chunk: Uint8Array) {
    for (const byte of chunk) this.bytes.push(byte);
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }

  clear() {
    this.bytes = [];
  }

  async readByte(timeoutMs: number): Promise<number | null> {
    const ready = await this.waitForLength(1, timeoutMs);
    if (!ready) return null;
    return this.bytes.shift() ?? null;
  }

  async readBytes(count: number, timeoutMs: number): Promise<Uint8Array | null> {
    const ready = await this.waitForLength(count, timeoutMs);
    if (!ready) return null;
    return Uint8Array.from(this.bytes.splice(0, count));
  }

  async waitForByte(expected: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      while (this.bytes.length > 0) {
        const byte = this.bytes.shift();
        if (byte === expected) return true;
      }

      const remaining = Math.max(1, deadline - Date.now());
      await this.waitForData(remaining);
    }

    return false;
  }

  private async waitForLength(count: number, timeoutMs: number): Promise<boolean> {
    if (this.bytes.length >= count) return true;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const ready = await this.waitForData(remaining);
      if (!ready) return this.bytes.length >= count;
      if (this.bytes.length >= count) return true;
    }

    return this.bytes.length >= count;
  }

  private waitForData(timeoutMs: number): Promise<boolean> {
    if (this.bytes.length > 0) {
      // Yield to the macro-task queue via setTimeout so pending I/O (serial
      // reads) can deliver bytes before we re-check the queue length.
      // Returning a resolved microtask here would spin without letting the
      // readLoop deliver the next chunk when only partial data has arrived.
      return new Promise((resolve) => setTimeout(() => resolve(true), 0));
    }

    return new Promise((resolve) => {
      const onData = () => {
        cleanup();
        resolve(true);
      };
      const timer = window.setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const cleanup = () => {
        window.clearTimeout(timer);
        this.waiters = this.waiters.filter((waiter) => waiter !== onData);
      };
      this.waiters.push(onData);
    });
  }
}

export class WebSerialTransport {
  readonly queue = new ByteQueue();

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readLoopDone: Promise<void> | null = null;
  private closing = false;

  constructor(private readonly onLog?: (entry: SerialLogEntry) => void) {}

  static isSupported() {
    return typeof navigator !== "undefined" && Boolean(navigator.serial);
  }

  static async closeGrantedPorts(onLog?: (entry: SerialLogEntry) => void) {
    if (!navigator.serial) throw new Error("Web Serial is not available in this browser.");
    const ports = await navigator.serial.getPorts();
    let closedCount = 0;

    for (const port of ports) {
      try {
        await port.close();
        closedCount += 1;
      } catch {
        // Closed ports also reject close(); ignore those while still attempting
        // every granted handle so a stale open handle can be released.
      }
    }

    onLog?.({
      level: "info",
      message:
        closedCount === 0
          ? "No granted serial ports needed releasing."
          : `Released ${closedCount} granted serial port${closedCount === 1 ? "" : "s"}.`,
    });

    return closedCount;
  }

  get isOpen() {
    return Boolean(this.port);
  }

  getPortInfo() {
    return this.port?.getInfo() ?? null;
  }

  async requestAndOpen() {
    if (!navigator.serial) throw new Error("Web Serial is not available in this browser.");
    await WebSerialTransport.closeGrantedPorts(this.onLog);
    const port = await navigator.serial.requestPort();
    try {
      await this.open(port);
    } catch (error) {
      await port.close().catch(() => undefined);
      throw new Error(toUserSerialError(error));
    }
  }

  async open(port: SerialPort) {
    let opened = false;

    try {
      await port.open({
        baudRate: 9600,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flowControl: "none",
      });
      opened = true;

      await port.setSignals({
        dataTerminalReady: true,
        requestToSend: true,
      });

      if (!port.readable || !port.writable) {
        throw new Error("Serial port did not expose readable and writable streams.");
      }

      this.port = port;
      this.closing = false;
      this.reader = port.readable.getReader();
      this.writer = port.writable.getWriter();
      this.log({ level: "info", message: "Serial port opened at 9600 8N1; DTR and RTS asserted." });
      this.readLoopDone = this.readLoop();
    } catch (error) {
      if (opened) await port.close().catch(() => undefined);
      throw error;
    }
  }

  async write(bytes: Uint8Array) {
    if (!this.writer) throw new Error("Serial writer is not open.");
    await this.writer.write(bytes);
    this.log({ level: "tx", message: hex(bytes), bytes });
  }

  async close() {
    this.closing = true;
    this.queue.clear();

    if (this.reader) {
      await this.reader.cancel().catch(() => undefined);
      this.reader.releaseLock();
      this.reader = null;
    }

    if (this.readLoopDone) {
      await this.readLoopDone.catch(() => undefined);
      this.readLoopDone = null;
    }

    if (this.writer) {
      await this.writer.close().catch(() => undefined);
      this.writer.releaseLock();
      this.writer = null;
    }

    if (this.port) {
      await this.port.close().catch(() => undefined);
      this.port = null;
      this.log({ level: "info", message: "Serial port closed." });
    }
  }

  private async readLoop() {
    if (!this.reader) return;

    try {
      while (!this.closing) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        this.queue.push(value);
        this.log({ level: "rx", message: hex(value), bytes: value });
      }
    } catch (error) {
      if (!this.closing) {
        this.log({ level: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private log(entry: SerialLogEntry) {
    this.onLog?.(entry);
  }
}

export function hex(bytes: Uint8Array | number[]) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function toUserSerialError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("No port selected")) {
    return "No serial port was selected.";
  }

  if (message.includes("Failed to open serial port") || message.includes("Failed to execute 'open'")) {
    return [
      "The browser could not open the serial port.",
      "The most common cause is that Chrome, another browser tab, or another application already has the USB serial adapter open.",
      "Close other tracer sessions, use Release ports, or restart the browser if the lock is stale.",
    ].join(" ");
  }

  return message;
}

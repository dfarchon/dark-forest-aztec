import type {
  ExecutionError,
  ForeignCallHandler,
} from "@aztec-foundation/noir-acvm_js";
import initAbi, {
  abiDecode,
  abiDecodeError,
  abiEncode,
} from "@aztec-foundation/noir-noirc_abi";
import type {
  ACIRCallback,
  ACIRExecutionResult,
  ACVMSuccess,
  ACVMWitness,
  CircuitSimulator,
  ProtocolCircuitResult,
} from "@aztec-labs/simulator/client";
import { WASMSimulator } from "@aztec-labs/simulator/client";
import type { FunctionArtifactWithContractName } from "@aztec-labs/stdlib/abi";
import type { NoirCompiledCircuitWithName } from "@aztec-labs/stdlib/noir";

import type {
  CircuitKind,
  ExecutionFailure,
  WorkerToMain,
} from "./acvmProtocol";
import {
  copyBytes,
  decodeBase64,
  packWitness,
  unpackWitness,
} from "./acvmWitness";

/**
 * PXE circuit simulator whose ACVM runs in a worker.
 *
 * Nested utility calls happen while a circuit is waiting on an oracle, so each
 * in-flight circuit gets its own worker. The worker WASM is not re-entered.
 * Oracle handlers stay on the main thread, where the PXE stores notes.
 */

type ForeignHandler = (
  name: string,
  inputs: string[][]
) => Promise<(string | string[])[]>;

type OkMessage = Extract<WorkerToMain, { type: "ok" }>;

class CircuitExecutionError extends Error {
  constructor(readonly fail: ExecutionFailure) {
    super(fail.message);
    this.name = "CircuitExecutionError";
  }
}

class AcvmWorkerClient {
  readonly ready: Promise<void>;
  stopped = false;
  private readonly worker: Worker;
  private current?: {
    jobId: number;
    foreign: ForeignHandler;
    resolve: (message: OkMessage) => void;
    reject: (err: Error) => void;
  };
  private settleReady: () => void = () => {};
  private failReady: (err: Error) => void = () => {};

  constructor() {
    this.ready = new Promise((resolve, reject) => {
      this.settleReady = resolve;
      this.failReady = reject;
    });
    this.worker = new Worker(new URL("./acvm.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      this.onMessage(event.data);
    };
    this.worker.onerror = (event) => {
      this.fail(new Error(event.message || "ACVM worker failed"));
    };
  }

  execute(request: {
    jobId: number;
    kind: CircuitKind;
    bytecode: Uint8Array;
    witness: ArrayBuffer;
    foreign: ForeignHandler;
  }): Promise<OkMessage> {
    if (this.current) {
      return Promise.reject(
        new Error("ACVM worker is already running a circuit")
      );
    }
    const bytecode = request.bytecode.buffer;
    const witness = request.witness;
    return new Promise((resolve, reject) => {
      this.current = {
        jobId: request.jobId,
        foreign: request.foreign,
        resolve,
        reject,
      };
      try {
        this.worker.postMessage(
          {
            type: "execute",
            jobId: request.jobId,
            kind: request.kind,
            bytecode,
            witness,
          },
          [bytecode, witness]
        );
      } catch (err) {
        this.current = undefined;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  destroy(): void {
    this.fail(new Error("ACVM worker stopped"));
    this.worker.terminate();
  }

  private fail(err: Error): void {
    if (this.stopped) return;
    this.stopped = true;
    this.failReady(err);
    this.current?.reject(err);
    this.current = undefined;
  }

  private onMessage(message: WorkerToMain): void {
    if (message.type === "ready") {
      this.settleReady();
      return;
    }
    if (message.type === "boot-error") {
      this.fail(new Error(message.message));
      return;
    }
    if (message.type === "foreign") {
      const current = this.current;
      if (!current || current.jobId !== message.jobId) return;
      void current.foreign(message.name, message.inputs).then(
        (outputs) => {
          if (this.stopped) return;
          this.worker.postMessage({
            type: "foreign-result",
            callId: message.callId,
            outputs,
          });
        },
        (err: unknown) => {
          if (this.stopped) return;
          this.worker.postMessage({
            type: "foreign-error",
            callId: message.callId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      );
      return;
    }
    const current = this.current;
    if (!current || current.jobId !== message.jobId) return;
    this.current = undefined;
    if (message.type === "ok") current.resolve(message);
    else current.reject(new CircuitExecutionError(message));
  }
}

let abiReady: Promise<unknown> | undefined;

async function initAbiWasm(): Promise<void> {
  if (typeof initAbi !== "function") {
    throw new Error("Noir ABI wasm init is missing");
  }
  abiReady ??= initAbi();
  await abiReady;
}

function attachFailure(error: Error, fail: ExecutionFailure): Error {
  const withFields = error as ExecutionError;
  if (fail.rawAssertionPayload) {
    withFields.rawAssertionPayload = fail.rawAssertionPayload;
  }
  if (fail.callStack) withFields.callStack = fail.callStack;
  if (fail.acirFunctionId !== undefined) {
    withFields.acirFunctionId = fail.acirFunctionId;
  }
  if (fail.brilligFunctionId !== undefined) {
    withFields.brilligFunctionId = fail.brilligFunctionId;
  }
  return withFields;
}

function protocolError(
  artifact: NoirCompiledCircuitWithName,
  fail: ExecutionFailure
): Error {
  const error = attachFailure(new Error(fail.message), fail) as ExecutionError;
  if (!fail.rawAssertionPayload) return error;
  try {
    const decoded = abiDecodeError(
      artifact.abi as Parameters<typeof abiDecodeError>[0],
      fail.rawAssertionPayload
    );
    if (typeof decoded === "string") {
      error.message = `Circuit execution failed: ${decoded}`;
    }
  } catch {
    // The raw assertion payload is still attached for the caller to decode.
  }
  return error;
}

const missingCallback: ForeignCallHandler = (name) => {
  throw new Error(`Oracle callback ${name} not found`);
};

export class WorkerCircuitSimulator implements CircuitSimulator {
  private readonly workers: AcvmWorkerClient[] = [];
  private readonly idle: AcvmWorkerClient[] = [];
  private fallback: WASMSimulator | undefined;
  private jobSeq = 0;
  private destroyed = false;
  private workersDisabled = false;
  private announced = false;

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.workersDisabled = true;
    for (const worker of this.workers) worker.destroy();
    this.workers.length = 0;
    this.idle.length = 0;
  }

  async executeProtocolCircuit<ReturnType>(
    inputs: Parameters<CircuitSimulator["executeProtocolCircuit"]>[0],
    artifact: NoirCompiledCircuitWithName,
    callback: ForeignCallHandler | undefined
  ): Promise<ProtocolCircuitResult<ReturnType>> {
    await initAbiWasm();
    const encoded = abiEncode(
      artifact.abi as Parameters<typeof abiEncode>[0],
      inputs
    );
    const { witness, duration } = await this.executeProtocolCircuitToWitness(
      encoded,
      artifact,
      callback
    );
    const decoded = abiDecode(
      artifact.abi as Parameters<typeof abiDecode>[0],
      witness
    ) as { return_value: ReturnType };
    return { returnValue: decoded.return_value, duration };
  }

  async executeProtocolCircuitToWitness(
    input: ACVMWitness,
    artifact: NoirCompiledCircuitWithName,
    callback: ForeignCallHandler | undefined
  ): Promise<ACVMSuccess> {
    // Kernel witness encoding calls abiEncode on this same module after the
    // user circuit returns, and also before this method on a later prove.
    await initAbiWasm();
    const handler = callback ?? missingCallback;
    if (!this.workersDisabled) {
      try {
        const bytecode = await decodeBase64(artifact.bytecode);
        const packed = await packWitness(input);
        const result = await this.withWorker((worker) =>
          worker.execute({
            jobId: ++this.jobSeq,
            kind: "circuit",
            bytecode: copyBytes(bytecode),
            witness: packed,
            foreign: (name, inputs) => handler(name, inputs),
          })
        );
        if (result.kind !== "circuit") {
          throw new Error("ACVM worker returned the wrong result");
        }
        return {
          status: 0 as ACVMSuccess["status"],
          duration: result.duration,
          witness: await unpackWitness(result.witness),
        };
      } catch (err) {
        if (err instanceof CircuitExecutionError) {
          throw protocolError(artifact, err.fail);
        }
        this.noteWorkerFailure(err);
      }
    }
    return this.local().executeProtocolCircuitToWitness(
      input,
      artifact,
      handler
    );
  }

  async executeUserCircuit(
    input: ACVMWitness,
    artifact: FunctionArtifactWithContractName,
    callback: ACIRCallback
  ): Promise<ACIRExecutionResult> {
    // The private kernel encodes its inputs with abiEncode only after this
    // returns. That wasm used to be initialized by WASMSimulator.init().
    await initAbiWasm();
    if (!this.workersDisabled) {
      try {
        const packed = await packWitness(input);
        const result = await this.withWorker((worker) =>
          worker.execute({
            jobId: ++this.jobSeq,
            kind: "return",
            bytecode: copyBytes(artifact.bytecode),
            witness: packed,
            foreign: (name, inputs) => {
              const oracle = callback[name];
              if (!oracle) {
                throw new Error(`Oracle callback ${name} not found`);
              }
              return oracle.call(callback, ...inputs);
            },
          })
        );
        if (result.kind !== "return") {
          throw new Error("ACVM worker returned the wrong result");
        }
        return {
          partialWitness: await unpackWitness(result.solved),
          returnWitness: await unpackWitness(result.returned),
        };
      } catch (err) {
        if (err instanceof CircuitExecutionError) {
          throw attachFailure(new Error(err.fail.message), err.fail);
        }
        this.noteWorkerFailure(err);
      }
    }
    return this.local().executeUserCircuit(input, artifact, callback);
  }

  private local(): WASMSimulator {
    this.fallback ??= new WASMSimulator();
    return this.fallback;
  }

  private noteWorkerFailure(err: unknown): void {
    console.warn(
      "[WalletManager] ACVM worker failed. Simulating on the main thread.",
      err
    );
    this.workersDisabled = true;
    for (const worker of this.workers) worker.destroy();
    this.workers.length = 0;
    this.idle.length = 0;
  }

  private async acquire(): Promise<AcvmWorkerClient> {
    if (this.destroyed || this.workersDisabled) {
      throw new Error("ACVM worker unavailable");
    }
    const existing = this.idle.pop();
    if (existing) return existing;
    const created = new AcvmWorkerClient();
    this.workers.push(created);
    try {
      await created.ready;
    } catch (err) {
      created.destroy();
      const index = this.workers.indexOf(created);
      if (index >= 0) this.workers.splice(index, 1);
      throw err;
    }
    if (this.destroyed || this.workersDisabled) {
      created.destroy();
      throw new Error("ACVM worker stopped");
    }
    if (!this.announced) {
      this.announced = true;
      console.info(
        "[WalletManager] Circuit simulation is running off the main thread."
      );
    }
    return created;
  }

  private release(worker: AcvmWorkerClient): void {
    if (this.destroyed || this.workersDisabled || worker.stopped) return;
    this.idle.push(worker);
  }

  private async withWorker<T>(
    run: (worker: AcvmWorkerClient) => Promise<T>
  ): Promise<T> {
    const worker = await this.acquire();
    try {
      return await run(worker);
    } finally {
      this.release(worker);
    }
  }
}

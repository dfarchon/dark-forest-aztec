import initACVM, {
  executeCircuit,
  executeCircuitWithReturnWitness,
  type ExecutionError,
} from "@aztec-foundation/noir-acvm_js";

import type {
  ExecutionFailure,
  MainToWorker,
  WorkerToMain,
} from "./acvmProtocol";
import { packWitnessSync, unpackWitnessSync } from "./acvmWitness";

/**
 * Runs Noir ACVM off the main thread. Oracle calls are posted back and the
 * circuit stays suspended until the main thread replies, so PXE state stays
 * where it is.
 */

const scope = self as unknown as Worker;

const ready = initACVM()
  .then(() => {
    post({ type: "ready" });
  })
  .catch((err: unknown) => {
    post({
      type: "boot-error",
      message: err instanceof Error ? err.message : String(err),
    });
  });

const foreignCalls = new Map<
  number,
  {
    resolve: (outputs: (string | string[])[]) => void;
    reject: (err: Error) => void;
  }
>();

let callSeq = 0;
let queue: Promise<void> = Promise.resolve();

function post(message: WorkerToMain, transfer?: Transferable[]): void {
  if (transfer) scope.postMessage(message, transfer);
  else scope.postMessage(message);
}

function ask(
  jobId: number,
  name: string,
  inputs: string[][]
): Promise<(string | string[])[]> {
  const callId = ++callSeq;
  return new Promise((resolve, reject) => {
    foreignCalls.set(callId, { resolve, reject });
    post({ type: "foreign", jobId, callId, name, inputs });
  });
}

function failureOf(err: unknown): ExecutionFailure {
  if (typeof err !== "object" || err === null) {
    return { message: String(err) };
  }
  const error = err as Partial<ExecutionError>;
  const payload = error.rawAssertionPayload;
  const raw =
    payload &&
    typeof payload.selector === "string" &&
    Array.isArray(payload.data)
      ? { selector: payload.selector, data: payload.data.map(String) }
      : undefined;
  return {
    message: typeof error.message === "string" ? error.message : String(err),
    rawAssertionPayload: raw,
    callStack: Array.isArray(error.callStack)
      ? error.callStack.map(String)
      : undefined,
    acirFunctionId: error.acirFunctionId,
    brilligFunctionId: error.brilligFunctionId,
  };
}

async function run(message: Extract<MainToWorker, { type: "execute" }>) {
  try {
    await ready;
    const witness = unpackWitnessSync(message.witness);
    const bytecode = new Uint8Array(message.bytecode);
    const started = performance.now();
    const foreign = (name: string, inputs: string[][]) =>
      ask(message.jobId, name, inputs);
    if (message.kind === "circuit") {
      const solved = await executeCircuit(bytecode, witness, foreign);
      const packed = packWitnessSync(solved);
      post(
        {
          type: "ok",
          jobId: message.jobId,
          duration: Math.round(performance.now() - started),
          kind: "circuit",
          witness: packed,
        },
        [packed]
      );
      return;
    }
    const solved = await executeCircuitWithReturnWitness(
      bytecode,
      witness,
      foreign
    );
    const solvedBytes = packWitnessSync(solved.solvedWitness);
    const returnedBytes = packWitnessSync(solved.returnWitness);
    post(
      {
        type: "ok",
        jobId: message.jobId,
        duration: Math.round(performance.now() - started),
        kind: "return",
        solved: solvedBytes,
        returned: returnedBytes,
      },
      [solvedBytes, returnedBytes]
    );
  } catch (err) {
    for (const pending of foreignCalls.values()) {
      pending.reject(new Error("circuit execution failed"));
    }
    foreignCalls.clear();
    post({ type: "fail", jobId: message.jobId, ...failureOf(err) });
  }
}

scope.onmessage = (event: MessageEvent<MainToWorker>) => {
  const message = event.data;
  if (message.type === "foreign-result") {
    foreignCalls.get(message.callId)?.resolve(message.outputs);
    foreignCalls.delete(message.callId);
    return;
  }
  if (message.type === "foreign-error") {
    foreignCalls.get(message.callId)?.reject(new Error(message.message));
    foreignCalls.delete(message.callId);
    return;
  }
  if (message.type === "execute") {
    queue = queue.then(() => run(message)).catch(() => undefined);
  }
};

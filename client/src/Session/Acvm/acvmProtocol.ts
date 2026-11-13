export type CircuitKind = "circuit" | "return";

export type RawAssertionPayload = {
  selector: string;
  data: string[];
};

export type ExecutionFailure = {
  message: string;
  rawAssertionPayload?: RawAssertionPayload;
  callStack?: string[];
  acirFunctionId?: number;
  brilligFunctionId?: number;
};

export type MainToWorker =
  | {
      type: "execute";
      jobId: number;
      kind: CircuitKind;
      bytecode: ArrayBuffer;
      witness: ArrayBuffer;
    }
  | {
      type: "foreign-result";
      callId: number;
      outputs: (string | string[])[];
    }
  | { type: "foreign-error"; callId: number; message: string };

export type WorkerToMain =
  | { type: "ready" }
  | { type: "boot-error"; message: string }
  | {
      type: "foreign";
      jobId: number;
      callId: number;
      name: string;
      inputs: string[][];
    }
  | {
      type: "ok";
      jobId: number;
      duration: number;
      kind: "circuit";
      witness: ArrayBuffer;
    }
  | {
      type: "ok";
      jobId: number;
      duration: number;
      kind: "return";
      solved: ArrayBuffer;
      returned: ArrayBuffer;
    }
  | ({ type: "fail"; jobId: number } & ExecutionFailure);

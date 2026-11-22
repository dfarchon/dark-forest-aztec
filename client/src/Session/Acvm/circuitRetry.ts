/**
 * Decides whether a failed worker execution may run again on the main thread.
 *
 * Oracle handlers mutate PXE state, including the revertible-phase flag. A
 * second execution of the same circuit calls `end_setup()` again and the
 * simulator rejects the transaction.
 */

export async function settleCircuitAttempt<T>(input: {
  error: unknown;
  oracleInvoked: boolean;
  isCircuitExecutionError: boolean;
  onWorkerFailure: (error: unknown, replay: boolean) => void;
  fallback: () => Promise<T>;
  rethrowCircuit: (error: unknown) => never;
}): Promise<T> {
  if (input.isCircuitExecutionError) {
    input.rethrowCircuit(input.error);
  }
  const replay = !input.oracleInvoked;
  input.onWorkerFailure(input.error, replay);
  if (!replay) {
    throw input.error instanceof Error
      ? input.error
      : new Error(String(input.error));
  }
  return input.fallback();
}

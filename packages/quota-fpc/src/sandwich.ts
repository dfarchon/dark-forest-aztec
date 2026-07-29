/**
 * Sandwich transaction assembly.
 *
 * Ordinary Aztec transactions originate at the user's account contract. A
 * sponsored one originates at the paymaster instead, which lets it inspect and
 * bind the payload before agreeing to pay. It then calls the user's account
 * entrypoint with that same payload, so the application still sees the user as
 * `msg_sender` and needs no changes.
 *
 *   paymaster.subscribe_and_execute(payload, user, generation, seat)
 *     -> allowlist check + allowance bookkeeping + pays + ends setup
 *     -> user_account.entrypoint(payload, EXTERNAL, false)
 *          -> verifies the user's signature over the payload
 *          -> runs the calls, so the app sees the USER
 *
 * Proven end-to-end against a local network in Phase 1 spike 1B.
 */
import { Fr } from "@aztec/foundation/curves/bn254";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";
import type { FunctionCall } from "@aztec/stdlib/abi";
import { ExecutionPayload } from "@aztec/stdlib/tx";

/** Account entrypoint's `fee_payment_method`: another contract pays. */
export const FEE_PAYMENT_EXTERNAL = 0;

export interface SandwichRequest {
  /** The application calls the user wants sponsored (at most 5). */
  calls: FunctionCall[];
  /** The user's account address. */
  player: AztecAddress;
  /** The paymaster. */
  fpcAddress: AztecAddress;
  generation: number;
  /** Provide for the user's first sponsored transaction of the day; omit after. */
  seat?: number;
}

/** The wallet capabilities this module needs. */
export interface SandwichWallet {
  createAuthWit(
    from: AztecAddress,
    intent: { consumer: AztecAddress; innerHash: Fr },
  ): Promise<unknown>;
}

/** Contract handle exposing the paymaster's two entrypoints. */
export interface QuotaFpcMethods {
  subscribe_and_execute: (...args: unknown[]) => { request(): Promise<any> };
  sponsor_and_execute: (...args: unknown[]) => { request(): Promise<any> };
}

export const ACCOUNT_MAX_CALLS = 5;

/**
 * Builds the ExecutionPayload for a sponsored transaction. The caller hands the
 * result to an entrypoint that does not wrap it in the account (aztec.js's
 * `DefaultEntrypoint`), because here the paymaster IS the origin.
 */
export async function buildSandwichPayload(
  request: SandwichRequest,
  wallet: SandwichWallet,
  fpc: { methods: QuotaFpcMethods },
  txNonce: Fr = Fr.random(),
): Promise<ExecutionPayload> {
  if (request.calls.length === 0) {
    throw new Error("A sponsored transaction needs at least one call");
  }
  if (request.calls.length > ACCOUNT_MAX_CALLS) {
    throw new Error(
      `A transaction carries at most ${ACCOUNT_MAX_CALLS} calls, got ${request.calls.length}`,
    );
  }

  const { EncodedAppEntrypointCalls } =
    await import("@aztec/entrypoints/encoding");
  const encodedCalls = await EncodedAppEntrypointCalls.create(
    request.calls as any,
    txNonce,
  );

  // The user signs the payload itself — the paymaster can pay for it but can
  // never alter what it does.
  const payloadHash = await encodedCalls.hash();
  const authWitness = await wallet.createAuthWit(request.player, {
    consumer: request.player,
    innerHash: payloadHash,
  });

  const isFirstOfDay = request.seat !== undefined;
  const interaction = isFirstOfDay
    ? fpc.methods.subscribe_and_execute(
        encodedCalls,
        request.player,
        request.generation,
        request.seat,
      )
    : fpc.methods.sponsor_and_execute(
        encodedCalls,
        request.player,
        request.generation,
      );

  const outer = await interaction.request();

  return new ExecutionPayload(
    outer.calls ?? outer,
    [authWitness as any, ...(outer.authWitnesses ?? [])],
    [...(outer.capsules ?? [])],
    // The inner calls' hashed arguments must travel with the transaction, or the
    // account's circuit cannot resolve what it is being asked to run.
    [...encodedCalls.hashedArguments, ...(outer.extraHashedArgs ?? [])],
    request.fpcAddress,
  );
}

import { Fr } from "@aztec/foundation/curves/bn254";
import { FunctionCall, FunctionSelector, FunctionType } from "@aztec/stdlib/abi";
import { ExecutionPayload } from "@aztec/stdlib/tx";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";

/**
 * The quota FPC's fee payment method — the standard sibling-call shape.
 *
 * Emits ONE private call to the FPC (subscribe for the day's first sponsored tx,
 * sponsor thereafter) and names the FPC as fee payer. The account entrypoint
 * executes this call, so inside the FPC `msg_sender` is the PLAYER's account —
 * the identity hook the whole quota design rests on.
 */
export class QuotaFeePaymentMethod {
  constructor(
    private fpcAddress: AztecAddress,
    private generation: number,
    /** Provide a seat for the first sponsored tx of the day (subscribe); omit for sponsor. */
    private seat?: number,
  ) {}

  getAsset(): Promise<AztecAddress> {
    throw new Error("Asset is not required for the quota FPC.");
  }

  getFeePayer(): Promise<AztecAddress> {
    return Promise.resolve(this.fpcAddress);
  }

  getGasSettings() {
    return undefined;
  }

  async getExecutionPayload(): Promise<ExecutionPayload> {
    const isSubscribe = this.seat !== undefined;
    const signature = isSubscribe ? "subscribe(u32,u32)" : "sponsor(u32)";
    const args = isSubscribe
      ? [new Fr(this.generation), new Fr(this.seat!)]
      : [new Fr(this.generation)];

    return new ExecutionPayload(
      [
        FunctionCall.from({
          name: isSubscribe ? "subscribe" : "sponsor",
          to: this.fpcAddress,
          selector: await FunctionSelector.fromSignature(signature),
          type: FunctionType.PRIVATE,
          hideMsgSender: false,
          isStatic: false,
          args,
          returnTypes: [],
        }),
      ],
      [],
      [],
      [],
      this.fpcAddress,
    );
  }
}

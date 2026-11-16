/**
 * One-line fee/gas record parsed by measure-storage-fees.ts.
 * Empty fields stay empty when the node or receipt does not provide them.
 */

type GasPair = { daGas?: unknown; l2Gas?: unknown };

type GasUsedLike = {
    totalGas?: GasPair;
    publicGas?: GasPair;
    billedGas?: GasPair;
    teardownGas?: GasPair;
};

function pair(g: GasPair | undefined): { da: string; l2: string } {
    return {
        da: g?.daGas == null ? '' : String(g.daGas),
        l2: g?.l2Gas == null ? '' : String(g.l2Gas),
    };
}

function readFee(receipt: unknown): string {
    if (!receipt || typeof receipt !== 'object') return '';
    const rec = receipt as {
        transactionFee?: unknown;
        receipt?: { transactionFee?: unknown };
    };
    const raw = rec.transactionFee ?? rec.receipt?.transactionFee;
    if (raw == null || raw === '') return '';
    return String(raw);
}

export function logFeeMeasure(
    name: string,
    gasUsed: GasUsedLike | null | undefined,
    receipt: unknown
): void {
    const total = pair(gasUsed?.totalGas);
    const pub = pair(gasUsed?.publicGas);
    const billed = pair(gasUsed?.billedGas);
    const teardown = pair(gasUsed?.teardownGas);
    console.log(
        `FEE_MEASURE name=${name} total_da=${total.da} total_l2=${total.l2} public_da=${pub.da} public_l2=${pub.l2} billed_da=${billed.da} billed_l2=${billed.l2} teardown_da=${teardown.da} teardown_l2=${teardown.l2} fee=${readFee(receipt)}`
    );
}

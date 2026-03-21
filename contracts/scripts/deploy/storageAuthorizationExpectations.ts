/**
 * Expected (system, storage) authorization after `configure.ts` Phase 3 + Phase 4.
 * Used by configure (batches) and `pnpm verify-perms` (is_authorized checks).
 *
 * Phase 3: addAuthorizedBatchIfNeeded per storage.
 * Phase 4: add artifact system addresses to a subset of storages (not ArrivalStorage).
 */
export type SystemContractName =
    | 'Admin'
    | 'Core'
    | 'Move'
    | 'ArtifactAction'
    | 'ArtifactFind'
    | 'ArtifactProspect'
    | 'ArtifactValut';

export type StorageContractName =
    | 'WorldStorage'
    | 'PlayerStorage'
    | 'PlanetStorage'
    | 'PlanetRevealedCoordsStorage'
    | 'PlanetEventsStorage'
    | 'PlanetArtifactsStorage'
    | 'ArrivalStorage'
    | 'ArtifactStorage'
    | 'ArtifactLocationStorage';

/** Phase 3: first authorized batch per storage (see configure.ts). */
export const PHASE3_AUTHORIZED_BY_STORAGE: Record<
    StorageContractName,
    readonly SystemContractName[]
> = {
    WorldStorage: ['Admin', 'Core', 'Move'],
    PlayerStorage: ['Admin', 'Core', 'Move'],
    PlanetStorage: ['Admin', 'Core', 'Move'],
    PlanetRevealedCoordsStorage: ['Core'],
    PlanetEventsStorage: ['Core', 'Move'],
    PlanetArtifactsStorage: ['Core', 'Move'],
    ArrivalStorage: ['Core', 'Move'],
    ArtifactStorage: ['Core', 'Move'],
    ArtifactLocationStorage: ['Core', 'Move'],
};

/** Phase 4: artifact systems also gain auth on these storages (not Arrival). */
export const PHASE4_ARTIFACT_EXTRA_STORAGES: readonly StorageContractName[] = [
    'WorldStorage',
    'PlayerStorage',
    'PlanetStorage',
    'PlanetArtifactsStorage',
    'PlanetEventsStorage',
    'ArtifactStorage',
    'ArtifactLocationStorage',
] as const;

export const ARTIFACT_SYSTEM_NAMES: readonly SystemContractName[] = [
    'ArtifactAction',
    'ArtifactFind',
    'ArtifactProspect',
    'ArtifactValut',
] as const;

function isArtifactSystem(system: SystemContractName): boolean {
    return (ARTIFACT_SYSTEM_NAMES as readonly string[]).includes(system);
}

/** Whether configure expects `is_authorized(system)` to be true on `storage`. */
export function configureExpectsAuthorized(
    system: SystemContractName,
    storage: StorageContractName
): boolean {
    if (PHASE3_AUTHORIZED_BY_STORAGE[storage].includes(system)) return true;
    if (
        (PHASE4_ARTIFACT_EXTRA_STORAGES as readonly string[]).includes(
            storage
        ) &&
        isArtifactSystem(system)
    ) {
        return true;
    }
    return false;
}

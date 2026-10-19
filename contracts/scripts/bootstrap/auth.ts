/** Expected system-to-storage permissions after bootstrap. */
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

export function bootstrapExpectsAuthorized(
    system: SystemContractName,
    storage: StorageContractName
): boolean {
    if (PHASE3_AUTHORIZED_BY_STORAGE[storage].includes(system)) return true;
    return (
        PHASE4_ARTIFACT_EXTRA_STORAGES.includes(storage) &&
        ARTIFACT_SYSTEM_NAMES.includes(system)
    );
}

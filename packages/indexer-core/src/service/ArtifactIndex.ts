import type { ArtifactState } from "../TableTypes/chain.ts";

function addTo(
  index: Map<string, Set<string>>,
  key: string,
  artifactId: string,
): void {
  let set = index.get(key);
  if (!set) {
    set = new Set();
    index.set(key, set);
  }
  set.add(artifactId);
}

/**
 * Secondary indexes from artifact owner and controller to artifact ids.
 * Rebuilt from a snapshot, then maintained on each artifact row upsert.
 */
export class ArtifactIndex {
  private readonly byOwnerIndex = new Map<string, Set<string>>();
  private readonly byControllerIndex = new Map<string, Set<string>>();

  onUpsert(
    artifactId: string,
    oldState: ArtifactState | undefined,
    newState: ArtifactState,
  ): void {
    if (oldState?.owner !== newState.owner) {
      if (oldState) {
        this.byOwnerIndex.get(oldState.owner)?.delete(artifactId);
      }
      if (newState.owner) addTo(this.byOwnerIndex, newState.owner, artifactId);
    }

    if (oldState?.controller !== newState.controller) {
      if (oldState) {
        this.byControllerIndex.get(oldState.controller)?.delete(artifactId);
      }
      if (newState.controller) {
        addTo(this.byControllerIndex, newState.controller, artifactId);
      }
    }
  }

  rebuild(artifacts: Iterable<[string, ArtifactState]>): void {
    this.byOwnerIndex.clear();
    this.byControllerIndex.clear();
    for (const [id, state] of artifacts) {
      if (state.owner) addTo(this.byOwnerIndex, state.owner, id);
      if (state.controller) addTo(this.byControllerIndex, state.controller, id);
    }
  }

  byOwner(ownerId: string): string[] {
    const set = this.byOwnerIndex.get(ownerId);
    return set ? Array.from(set) : [];
  }

  byController(controllerId: string): string[] {
    const set = this.byControllerIndex.get(controllerId);
    return set ? Array.from(set) : [];
  }
}

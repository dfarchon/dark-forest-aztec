import type { Abstract, AztecAddr, LocationId } from "../identifiers";

/**
 * Protocol for messages on planets (e.g. emoji flags). Rate limiting and
 * ownership are not enforced by this type layer.
 */
export type PlanetMessageType = Abstract<string, "PlanetMessageType">;

export const PlanetMessageType = {
  EmojiFlag: "EmojiFlag" as PlanetMessageType,
} as const;

export interface EmojiFlagBody {
  emoji: string;
}

export type PlanetMessageBody = EmojiFlagBody | unknown;

export interface PlanetMessage<T extends PlanetMessageBody> {
  id: string;
  type: PlanetMessageType;
  sender: AztecAddr;
  timeCreated: number;
  planetId: LocationId;
  body: T;
}

export interface PlanetMessageRequest {
  planets: LocationId[];
}

export interface PlanetMessageResponse {
  [planetId: string]: PlanetMessage<unknown>[];
}

export interface PostMessageRequest<T extends PlanetMessageBody> {
  type: PlanetMessageType;
  locationId: LocationId;
  body: T;
}

export interface DeleteMessagesRequest {
  locationId: LocationId;
  ids: string[];
}

export interface SignedMessage<T> {
  sender?: AztecAddr;
  signature?: string;
  message: T;
}

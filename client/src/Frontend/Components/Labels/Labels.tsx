import { EMPTY_ADDRESS } from "@dfpunk/constants";
import { getPlayerColor } from "@dfpunk/procedural";
import { EthAddress } from "@dfpunk/types";
import colorFn from "color";
import React from "react";

import { useActiveAccount, useVerifiedFogName } from "../../../Session/FogName";
import { usePlayer, useUIManager } from "../../Utils/AppHooks";
import { Link } from "../CoreUI";
import { Sub } from "../Text";
import { TextPreview } from "../TextPreview";

export function AccountLabel({
  includeAddressIfHasTwitter,
  ethAddress,
  width,
  style,
}: {
  includeAddressIfHasTwitter?: boolean;
  ethAddress?: EthAddress;
  width?: string;
  style?: React.CSSProperties;
}) {
  const uiManager = useUIManager();
  const currentAccount = useActiveAccount(uiManager);
  const player = usePlayer(uiManager, ethAddress);
  const targetAddress =
    ethAddress === EMPTY_ADDRESS ? undefined : ethAddress || currentAccount;
  const verifiedFogName = useVerifiedFogName(uiManager, targetAddress);

  if (ethAddress === EMPTY_ADDRESS) {
    return <>nobody</>;
  }

  const fallbackText = targetAddress || "<no account>";

  if (verifiedFogName !== undefined) {
    return (
      <span style={style} title={targetAddress}>
        {verifiedFogName}
        {includeAddressIfHasTwitter && (
          <Sub>
            {" "}
            <TextPreview
              text={fallbackText}
              unFocusedWidth={"50px"}
              focusedWidth={"50px"}
            />
          </Sub>
        )}
      </span>
    );
  }

  if (player.value !== undefined && player.value.twitter !== undefined) {
    const color = colorFn(getPlayerColor(player.value.address))
      .darken(0.5)
      .hex();
    return (
      <span style={style}>
        <TwitterLink twitter={player.value.twitter} color={color} />
        {includeAddressIfHasTwitter && (
          <Sub>
            {" "}
            <TextPreview
              text={fallbackText}
              unFocusedWidth={"50px"}
              focusedWidth={"50px"}
            />
          </Sub>
        )}
      </span>
    );
  }

  return (
    <TextPreview
      text={fallbackText}
      unFocusedWidth={width ?? "150px"}
      focusedWidth={width ?? "150px"}
    />
  );
}

/**
 * Link to a twitter account.
 */
export function TwitterLink({
  twitter,
  color,
}: {
  twitter: string;
  color?: string;
}) {
  return (
    <Link color={color} to={`https://twitter.com/${twitter}`}>
      @{twitter}
    </Link>
  );
}

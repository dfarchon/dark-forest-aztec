import React, { useEffect, useState } from "react";
import styled from "styled-components";

import { getEffectiveUseSponsoredFpc } from "../../config/connection";
import {
  getSponsoredFpcMinBalanceFjWei,
  getSponsoredFpcWarningBalanceFjWei,
  getSponsorMode,
} from "../../config/env";
import { externalLinks } from "../../config/externalLinks";
import { formatFeeJuiceWei } from "../../utils/feeJuiceUnits";
import dfstyles from "../Styles/dfstyles";
import { useUIManager } from "../Utils/AppHooks";
import { DFZIndex } from "../Utils/constants";

const SPONSOR_BALANCE_POLL_INTERVAL_MS = 5_000;
export const SPONSORED_FPC_WARNING_PREVIEW_EVENT =
  "dfpunk:sponsored-fpc-warning-preview";

export function SponsoredFpcBalanceWarning() {
  const uiManager = useUIManager();
  const [balanceWei, setBalanceWei] = useState<bigint | undefined>();
  const [previewVisible, setPreviewVisible] = useState(false);

  useEffect(() => {
    const onPreviewChange = (event: Event) => {
      setPreviewVisible((event as CustomEvent<boolean>).detail);
    };
    window.addEventListener(
      SPONSORED_FPC_WARNING_PREVIEW_EVENT,
      onPreviewChange
    );
    return () => {
      window.removeEventListener(
        SPONSORED_FPC_WARNING_PREVIEW_EVENT,
        onPreviewChange
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;

    const tick = async () => {
      if (!getSponsorMode() || !getEffectiveUseSponsoredFpc()) {
        if (!cancelled) setBalanceWei(undefined);
        return;
      }
      if (requestInFlight) return;

      requestInFlight = true;
      try {
        const balance = await uiManager
          .getGameManager()
          .getSponsoredFpcFeeJuiceBalance();
        if (!cancelled) setBalanceWei(balance);
      } catch (error) {
        console.error("Failed to read SponsoredFPC balance:", error);
        if (!cancelled) setBalanceWei(undefined);
      } finally {
        requestInFlight = false;
      }
    };

    void tick();
    const intervalId = window.setInterval(
      () => void tick(),
      SPONSOR_BALANCE_POLL_INTERVAL_MS
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [uiManager]);

  const warningWei = getSponsoredFpcWarningBalanceFjWei();
  const displayedBalanceWei = previewVisible ? warningWei - 1n : balanceWei;
  if (displayedBalanceWei === undefined || displayedBalanceWei >= warningWei) {
    return null;
  }

  const transactionsBlocked =
    displayedBalanceWei < getSponsoredFpcMinBalanceFjWei();

  return (
    <WarningContainer role="alert">
      <div>
        SponsoredFPC FeeJuice is low: {formatFeeJuiceWei(displayedBalanceWei)}{" "}
        (warning threshold: {formatFeeJuiceWei(warningWei)}).{" "}
        {transactionsBlocked
          ? "Sponsored transactions are blocked. Please disable SponsoredFPC in Settings and bridge some gas to your own account."
          : "Please disable SponsoredFPC in Settings and bridge some gas to your own account."}
      </div>
      <div>
        Need help? Send a direct message to{" "}
        <ContactLink
          href={externalLinks.dfArchon.twitter}
          target="_blank"
          rel="noreferrer"
        >
          DFArchon on X
        </ContactLink>
        ; The team members will reply once they find their way out of the Dark
        Forest.
      </div>
      <div>
        The team may randomly add more gas to SponsoredFPC later, but please do
        not count on it.
      </div>
    </WarningContainer>
  );
}

const WarningContainer = styled.div`
  position: absolute;
  z-index: ${DFZIndex.MenuBar};
  top: 34px;
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100vw - 32px));
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid ${dfstyles.colors.dfyellow};
  border-radius: ${dfstyles.borderRadius};
  background: ${dfstyles.colors.background};
  color: ${dfstyles.colors.dfyellow};
  text-align: center;
  line-height: 1.35;
`;

const ContactLink = styled.a`
  color: ${dfstyles.colors.dfblue};
  text-decoration: underline;
`;

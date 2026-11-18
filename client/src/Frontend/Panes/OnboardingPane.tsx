import { CHAIN_DISPLAY_NAME, GAME_NAME } from "@dfpunk/constants";
import { ModalName } from "@dfpunk/types";
import React, { useEffect, useState } from "react";
import styled from "styled-components";

import { Btn } from "../Components/Btn";
import { Icon, IconType } from "../Components/Icons";
import { Green, Red, White } from "../Components/Text";
import { TextPreview } from "../Components/TextPreview";
import dfstyles from "../Styles/dfstyles";
import { useAccount, useUIManager } from "../Utils/AppHooks";
import { ModalPane } from "../Views/ModalPane";

const StyledOnboardingContent = styled.div`
  width: 36em;
  height: 32em;
  position: relative;
  color: ${dfstyles.colors.text};

  .btn {
    position: absolute;
    right: 0.5em;
    bottom: 0.5em;
  }

  .indent {
    margin-left: 1em;
  }

  & > p,
  & > div {
    margin: 1em 0;
  }

  & > div {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
  }

  .footer-actions {
    position: absolute;
    right: 0.5em;
    bottom: 0.5em;
    display: flex;
    flex-direction: row;
    gap: 0.5em;
    align-items: center;
  }

  .footer-actions .btn {
    position: static;
  }
`;

const enum OnboardState {
  Money,
  Storage,
  Keys,
  Help,
  Finished,
}

function OnboardMoney({ advance }: { advance: () => void }) {
  const uiManager = useUIManager();
  const account = useAccount(uiManager);

  const explorerAddressLink = `https://testnet.aztecscan.xyz/address/${account}`;

  return (
    <StyledOnboardingContent>
      <p>
        Welcome to <Green>Dark Forest Aztec</Green>!
      </p>
      <p>We have initialized a {CHAIN_DISPLAY_NAME} burner wallet for you.</p>
      <p className="indent">
        Your burner wallet address is: <br />
        <White>
          <a onClick={() => window.open(explorerAddressLink)}>{account}</a>
        </White>
      </p>
      <p>
        This means that when you make moves on Dark Forest Aztec,{" "}
        <White>
          {" "}
          you are authorizing the client to pay gas fees on your behalf
        </White>
        .
      </p>
      {/* <p>
        To ensure the safety of your balance,{" "}
        <White>we require you to enable popups</White> so that all transactions
        may be confirmed by you. Note that you can disable popups for small
        transactions in settings. <Icon type={IconType.Settings} />
      </p> */}
      <p>
        This is a fully onchain application, which means{" "}
        <White>every action</White> you take will require gas fees.
      </p>
      <p>
        <White>
          Make sure you understand all of the above before proceeding.
        </White>
      </p>

      <div>
        <span></span>
        <Btn className="btn" onClick={advance}>
          I understand, please proceed.
        </Btn>
      </div>
    </StyledOnboardingContent>
  );
}

function OnboardStorage({ advance }: { advance: () => void }) {
  return (
    <StyledOnboardingContent>
      <p>
        The game stores important information like your{" "}
        <White>private key</White>, <White>home coordinates</White>, and{" "}
        <White>map data</White> in your browser's local storage / cache.{" "}
        <Red>If you clear your browser history, you risk losing your data!</Red>
      </p>
      <p>
        Your <White>private key and home coordinates</White> act as your
        password. You can use them to access your Dark Forest account on other
        browsers, or to continue playing if you accidentally clear local
        storage. But this also means{" "}
        <Red>they should never be viewed by anyone else!</Red>
      </p>
      <p>
        <White>Make sure you back them up</White> and keep them somewhere safe.
      </p>
      <p>
        On the next page, you will be able to view and copy your private key and
        home coordinates.{" "}
        <White>When you are ready to back them up, please proceed.</White>
      </p>
      <div>
        <span></span>
        <Btn className="btn" onClick={advance}>
          Proceed
        </Btn>
      </div>
    </StyledOnboardingContent>
  );
}
function OnboardKeys({ advance }: { advance: () => void }) {
  const uiManager = useUIManager();
  const account = useAccount(uiManager);
  const [credentials, setCredentials] = useState<{
    secretKey: string;
    salt: string;
    signingKey: string;
  }>();

  const [home, setHome] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!uiManager) return;
    setCredentials(uiManager.getAccountCredentials());
    const coords = uiManager.getHomeCoords();
    setHome(coords ? `(${coords.x}, ${coords.y})` : "");
  }, [uiManager]);

  const canDownloadPrivacy =
    !!credentials?.secretKey &&
    !!credentials?.salt &&
    !!credentials?.signingKey;

  function downloadPrivacyInfo() {
    if (!credentials || !canDownloadPrivacy) return;
    try {
      const payload = {
        secretKey: credentials.secretKey,
        salt: credentials.salt,
        signingKey: credentials.signingKey,
        address: account ?? "",
        homeCoordinates: home ?? "",
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeAddr =
        account && account.length >= 10 ? `${account.slice(0, 10)}` : "account";
      a.download = `dark-forest-privacy-${safeAddr}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <StyledOnboardingContent>
      <div>
        Your secret key is:
        <TextPreview
          text={credentials?.secretKey}
          focusedWidth={"150px"}
          unFocusedWidth={"150px"}
        />
      </div>
      <div>
        Your salt is:
        <TextPreview
          text={credentials?.salt}
          focusedWidth={"150px"}
          unFocusedWidth={"150px"}
        />
      </div>
      <div>
        Your signing key is:
        <TextPreview
          text={credentials?.signingKey}
          focusedWidth={"150px"}
          unFocusedWidth={"150px"}
        />
      </div>
      <p>
        Your home coordinates are: <br />
        <White>{home}</White>
      </p>

      <p>
        When you have backed up your credentials and coordinates, please
        proceed.
      </p>

      <div className="footer-actions">
        <Btn
          className="btn"
          disabled={!canDownloadPrivacy}
          onClick={downloadPrivacyInfo}
        >
          Download privacy info
        </Btn>
        <Btn onClick={advance} className="btn">
          Proceed
        </Btn>
      </div>
    </StyledOnboardingContent>
  );
}

function OnboardHelp({ advance }: { advance: () => void }) {
  return (
    <StyledOnboardingContent>
      <p>
        For an overview of how to play, rules, and scoring, click the question
        mark icon on the left to open the <White>Help Pane</White>.
      </p>
      <div>
        <span></span>
        <Btn onClick={advance} className="btn">
          Proceed
        </Btn>
      </div>
    </StyledOnboardingContent>
  );
}

function OnboardFinished({ advance }: { advance: () => void }) {
  return (
    <StyledOnboardingContent>
      <p>That's all! You're now ready to play the game!</p>
      <p>
        We invite you to log into the universe. Click <White>Proceed</White> to
        join the world of <White>{GAME_NAME}...</White>
      </p>
      <div>
        <span></span>
        <Btn onClick={advance} className="btn">
          Proceed
        </Btn>
      </div>
    </StyledOnboardingContent>
  );
}

export default function OnboardingPane({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [onboardState, setOnboardState] = useState<OnboardState>(
    OnboardState.Money
  );

  const advance = () => setOnboardState((x) => x + 1);

  useEffect(() => {
    if (onboardState === OnboardState.Finished + 1) {
      onClose();
    }
  }, [onboardState, onClose]);

  return (
    <ModalPane
      id={ModalName.Onboarding}
      title={"Welcome to Dark Forest Aztec"}
      hideClose
      visible={visible}
      onClose={onClose}
    >
      {onboardState === OnboardState.Money && (
        <OnboardMoney advance={advance} />
      )}
      {onboardState === OnboardState.Storage && (
        <OnboardStorage advance={advance} />
      )}
      {onboardState === OnboardState.Keys && <OnboardKeys advance={advance} />}
      {onboardState === OnboardState.Help && <OnboardHelp advance={advance} />}
      {onboardState === OnboardState.Finished && (
        <OnboardFinished advance={advance} />
      )}
    </ModalPane>
  );
}

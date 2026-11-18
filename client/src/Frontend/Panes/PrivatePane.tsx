import { ModalName } from "@dfpunk/types";
import React, { useEffect, useState } from "react";
import styled from "styled-components";

import { Sub } from "../Components/Text";
import { TextPreview } from "../Components/TextPreview";
import { useUIManager } from "../Utils/AppHooks";
import { ModalPane } from "../Views/ModalPane";

const StyledPrivatePane = styled.div`
  width: 36em;

  .field {
    margin-bottom: 0.75em;
  }

  .field-label {
    margin-bottom: 0.2em;
  }
`;

export function PrivatePane({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const uiManager = useUIManager();

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

  return (
    <ModalPane
      id={ModalName.Private}
      title="View Secret Key and Home Coords"
      visible={visible}
      onClose={onClose}
    >
      <StyledPrivatePane>
        <div className="field">
          <div className="field-label">
            <Sub>
              <u>Secret Key</u>
            </Sub>
          </div>
          <div>
            <TextPreview
              text={credentials?.secretKey}
              focusedWidth={"150px"}
              unFocusedWidth={"150px"}
            />
          </div>
        </div>
        <div className="field">
          <div className="field-label">
            <Sub>
              <u>Salt</u>
            </Sub>
          </div>
          <div>
            <TextPreview
              text={credentials?.salt}
              focusedWidth={"150px"}
              unFocusedWidth={"150px"}
            />
          </div>
        </div>
        <div className="field">
          <div className="field-label">
            <Sub>
              <u>Signing Key</u>
            </Sub>
          </div>
          <div>
            <TextPreview
              text={credentials?.signingKey}
              focusedWidth={"150px"}
              unFocusedWidth={"150px"}
            />
          </div>
        </div>
        <div className="field">
          <div className="field-label">
            <Sub>
              <u>Home Coords</u>
            </Sub>
          </div>
          <div>{home}</div>
        </div>
      </StyledPrivatePane>
    </ModalPane>
  );
}

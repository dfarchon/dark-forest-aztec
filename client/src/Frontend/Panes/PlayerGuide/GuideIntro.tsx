import React from "react";

import { Btn } from "../../Components/Btn";
import { Link } from "../../Components/CoreUI";
import dfstyles from "../../Styles/dfstyles";
import { TASK_ORDER } from "./guideChapters";
import { BrightAction } from "./guidePanelStyles";
export function CoverCopy({ onStart }: { onStart: () => void }) {
  return (
    <>
      <p>
        Dark Forest is a fully onchain ZK warfare of exploration, strategy, and
        conquest.
      </p>
      <p>
        Follow {TASK_ORDER.length} short chapters: your planet, sending energy,
        ships, exploration, controls, and scoring with account safety.
      </p>
      <BrightAction>
        <Btn size="stretch" onClick={onStart}>
          Start guide
        </Btn>
      </BrightAction>
    </>
  );
}

export function PlayCopy() {
  return (
    <>
      <p>
        This is the whole guide, only a basic introduction. Dark Forest has more
        worth exploring.
      </p>
      <p>
        Follow us on Twitter:{" "}
        <Link to="https://twitter.com/DFArchon" color={dfstyles.colors.dfpink}>
          @DFArchon
        </Link>
      </p>
    </>
  );
}

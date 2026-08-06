import { CHAIN_DISPLAY_NAME } from "@dfpunk/constants";
import { Chunk, ModalName, Setting } from "@dfpunk/types";
import React, { useEffect, useState } from "react";
import styled from "styled-components";

import TutorialManager from "../../Backend/GameLogic/TutorialManager";
import {
  getEffectiveSponsoredFpcAddressOverride,
  getEffectiveUseSponsoredFpc,
  setConnectionOverrides,
} from "../../config/connection";
import {
  getAccountMinBalanceFjWei,
  getSponsoredFpcMinBalanceFjWei,
  getSponsorMode,
} from "../../config/env";
import { externalLinks } from "../../config/externalLinks";
import { formatFeeJuiceWei } from "../../utils/feeJuiceUnits";
import { Btn } from "../Components/Btn";
import { Link, Section, SectionHeader, Spacer } from "../Components/CoreUI";
import { Checkbox, DarkForestCheckbox, TextInput } from "../Components/Input";
import { Slider } from "../Components/Slider";
import { Green, Red } from "../Components/Text";
import Viewport, { getDefaultScroll } from "../Game/Viewport";
import { useAccount, useUIManager } from "../Utils/AppHooks";
import {
  BooleanSetting,
  ColorSetting,
  NumberSetting,
} from "../Utils/SettingsHooks";
import { ModalPane } from "../Views/ModalPane";

const SCROLL_MIN = 0.0001 * 10000;
const SCROLL_MAX = 0.01 * 10000;
const DEFAULT_SCROLL = Math.round(10000 * (getDefaultScroll() - 1));

const SettingsContent = styled.div`
  width: 500px;
  height: 500px;
  overflow-y: scroll;
  display: flex;
  flex-direction: column;
  text-align: justify;
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;

  justify-content: space-between;
  align-items: center;

  & > span:first-child {
    flex-grow: 1;
  }
`;

export function SettingsPane({
  visible,
  onClose,
  onOpenPrivate,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenPrivate: () => void;
}) {
  const uiManager = useUIManager();
  const isExternalWallet = uiManager.getGameManager().isExternalWallet();
  const account = useAccount(uiManager);
  const isDevelopment = process.env.NODE_ENV !== "production";
  const sponsorMode = getSponsorMode();

  const [balance, setBalance] = useState<number>(0);
  const [accountFjWei, setAccountFjWei] = useState<bigint>(0n);
  const [sponsorFjWei, setSponsorFjWei] = useState<bigint | undefined>(
    undefined
  );
  const [useSponsoredFpc, setUseSponsoredFpc] = useState(
    getEffectiveUseSponsoredFpc()
  );

  useEffect(() => {
    if (!uiManager) return;
    const updateBalance = () => {
      setBalance(uiManager.getMyBalance());
      setAccountFjWei(uiManager.getMyBalanceBn());
    };

    updateBalance();
    const intervalId = setInterval(updateBalance, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [uiManager]);

  useEffect(() => {
    if (visible) {
      setUseSponsoredFpc(getEffectiveUseSponsoredFpc());
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !sponsorMode || !useSponsoredFpc) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const b = await uiManager
          .getGameManager()
          .getSponsoredFpcFeeJuiceBalance();
        if (!cancelled) setSponsorFjWei(b);
      } catch (err) {
        console.error(err);
        if (!cancelled) setSponsorFjWei(undefined);
      }
    };
    void tick();
    const intervalId = setInterval(() => {
      void tick();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [sponsorMode, useSponsoredFpc, visible, uiManager]);

  const sponsorFjMinWei = getSponsoredFpcMinBalanceFjWei();
  const sponsorFjLow =
    sponsorFjWei !== undefined && sponsorFjWei < sponsorFjMinWei;
  const accountFjMinWei = getAccountMinBalanceFjWei();
  const accountFjLow = accountFjWei < accountFjMinWei;

  const onUseSponsoredFpcChange = (e: Event) => {
    const enabled = (e.target as DarkForestCheckbox).checked;
    setConnectionOverrides({ useSponsoredFpc: enabled });
    setUseSponsoredFpc(enabled);
  };

  const [failure, setFailure] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [importMapByTextBoxValue, setImportMapByTextBoxValue] = useState("");
  useEffect(() => {
    if (failure) {
      setSuccess("");
    }
  }, [failure]);
  useEffect(() => {
    if (success) {
      setFailure("");
    }
  }, [success]);
  const onExportMap = async () => {
    if (uiManager) {
      const chunks = uiManager.getExploredChunks();
      const chunksAsArray = Array.from(chunks);
      try {
        const map = JSON.stringify(chunksAsArray);
        await window.navigator.clipboard.writeText(map);
        setSuccess("Copied map!");
      } catch (err) {
        console.error(err);
        setFailure("Failed to export");
      }
    } else {
      setFailure("Unable to export map right now.");
    }
  };
  const onImportMapFromTextBox = async () => {
    try {
      const chunks = JSON.parse(importMapByTextBoxValue);
      await uiManager.bulkAddNewChunks(chunks as Chunk[]);
      setImportMapByTextBoxValue("");
    } catch (e) {
      setFailure("Invalid map data. Check the data in your clipboard.");
    }
  };
  const onImportMap = async () => {
    if (uiManager) {
      let input;
      try {
        input = await window.navigator.clipboard.readText();
      } catch (err) {
        console.error(err);
        setFailure("Unable to import map. Did you allow clipboard access?");
        return;
      }

      let chunks;
      try {
        chunks = JSON.parse(input);
      } catch (err) {
        console.error(err);
        setFailure("Invalid map data. Check the data in your clipboard.");
        return;
      }
      await uiManager.bulkAddNewChunks(chunks as Chunk[]);
      setSuccess("Successfully imported a map!");
    } else {
      setFailure("Unable to import map right now.");
    }
  };

  const [clicks, setClicks] = useState<number>(8);
  const doPrivateClick = () => {
    setClicks((x) => x - 1);
    if (clicks === 1) {
      onOpenPrivate();
      setClicks(5);
    }
  };

  const [scrollSpeed, setScrollSpeed] = useState<number>(DEFAULT_SCROLL);
  const onScrollChange = (e: Event) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value)) setScrollSpeed(value);
  };

  useEffect(() => {
    const scroll = localStorage.getItem("scrollSpeed");
    if (scroll) {
      setScrollSpeed(10000 * (parseFloat(scroll) - 1));
    }
  }, [setScrollSpeed]);

  useEffect(() => {
    if (!Viewport.instance) return;
    Viewport.instance.setMouseSensitivty(scrollSpeed / 10000);
  }, [scrollSpeed]);

  return (
    <ModalPane
      id={ModalName.Settings}
      title="Settings"
      visible={visible}
      onClose={onClose}
    >
      <SettingsContent>
        {isDevelopment && (
          <Section>
            <SectionHeader>Development</SectionHeader>
            <BooleanSetting
              uiManager={uiManager}
              setting={Setting.ForceReloadEmbeddedPlugins}
              settingDescription={"force reload embedded plugins"}
            />
          </Section>
        )}

        <Section>
          <SectionHeader>Current Wallet</SectionHeader>
          <Row>
            <span>Public Key</span>
            <span>{account}</span>
          </Row>
          <Row>
            <span>Balance</span>
            <span>{balance}</span>
          </Row>
        </Section>

        <Section>
          <SectionHeader>Transaction fees</SectionHeader>
          {sponsorMode && (
            <>
              <Checkbox
                label="Use SponsoredFPC to pay transaction fees"
                checked={useSponsoredFpc}
                onChange={onUseSponsoredFpcChange}
              />
              <Spacer height={12} />
            </>
          )}

          {useSponsoredFpc ? (
            <>
              SponsoredFPC is the selected payer. If its FeeJuice balance is too
              low, transactions fail instead of charging your account.
              <Spacer height={12} />
              <Row>
                <span>Local / env override</span>
                <span
                  style={{
                    wordBreak: "break-all",
                    maxWidth: 260,
                    textAlign: "right",
                    fontFamily: "monospace",
                    fontSize: "11px",
                  }}
                >
                  {getEffectiveSponsoredFpcAddressOverride() ??
                    "(none — canonical)"}
                </span>
              </Row>
              <Row>
                <span>Active payer (this session)</span>
                <span
                  style={{
                    wordBreak: "break-all",
                    maxWidth: 260,
                    textAlign: "right",
                    fontFamily: "monospace",
                    fontSize: "11px",
                  }}
                >
                  {uiManager.getGameManager().getSponsoredFpcAddress() ?? "—"}
                </span>
              </Row>
              <Row>
                <span>SponsoredFPC FeeJuice</span>
                <span>
                  {sponsorFjWei === undefined
                    ? "—"
                    : formatFeeJuiceWei(sponsorFjWei)}
                </span>
              </Row>
              <Row>
                <span>Minimum balance</span>
                <span>{formatFeeJuiceWei(sponsorFjMinWei)}</span>
              </Row>
              {sponsorFjLow && (
                <>
                  <Spacer height={8} />
                  <Red>
                    SponsoredFPC balance is below the configured minimum.
                    Transactions are blocked; fund it or change the address in
                    Connection settings.
                  </Red>
                </>
              )}
              <Spacer height={8} />
              <Btn
                size="stretch"
                onClick={async () => {
                  const addr = uiManager
                    .getGameManager()
                    .getSponsoredFpcAddress();
                  if (!addr) {
                    setFailure("No SponsoredFPC address for this session.");
                    return;
                  }
                  try {
                    await window.navigator.clipboard.writeText(addr);
                    setSuccess("Copied SponsoredFPC address.");
                  } catch (err) {
                    console.error(err);
                    setFailure("Failed to copy to clipboard.");
                  }
                }}
              >
                Copy active SponsoredFPC address
              </Btn>
            </>
          ) : (
            <>
              Your active account pays transaction fees with its own FeeJuice.
              <Spacer height={12} />
              <Row>
                <span>Account FeeJuice</span>
                <span>{formatFeeJuiceWei(accountFjWei)}</span>
              </Row>
              <Row>
                <span>Minimum balance</span>
                <span>{formatFeeJuiceWei(accountFjMinWei)}</span>
              </Row>
              {accountFjLow && (
                <>
                  <Spacer height={8} />
                  <Red>
                    Account FeeJuice is below the configured minimum. Fund this
                    account before sending transactions.
                  </Red>
                </>
              )}
              <Spacer height={8} />
              <Link to={externalLinks.aztecMainnet.feeJuiceBridge}>
                Open FeeJuice bridge
              </Link>
            </>
          )}
        </Section>

        {/* Gas price section removed: Aztec uses sponsored fee payment */}

        {!isExternalWallet ? (
          <Section>
            <SectionHeader>Wallet Keys</SectionHeader>
            Your secret key, together with your home planet's coordinates, grant
            you access to your Dark Forest account on different browsers. You
            should save this info somewhere on your computer.
            <Spacer height={16} />
            <Red>WARNING:</Red> Never ever send this to anyone!
            <Spacer height={8} />
            <Btn size="stretch" variant="danger" onClick={doPrivateClick}>
              Click {clicks} times to view info
            </Btn>
          </Section>
        ) : (
          <Section>
            <SectionHeader>Wallet Keys</SectionHeader>
            This session is using an external wallet. Private keys stay in the
            connected extension and are not available in this app.
          </Section>
        )}

        <Section>
          <SectionHeader>Auto Confirm Transactions</SectionHeader>
          Whether or not to auto-confirm all transactions, except purchases.
          This will allow you to make moves, spend silver on upgrades, etc.
          without requiring you to confirm each transaction. However, the client
          WILL ask for confirmation before sending transactions that spend
          wallet funds.
          <Spacer height={16} />
          <BooleanSetting
            uiManager={uiManager}
            setting={Setting.AutoApproveNonPurchaseTransactions}
            settingDescription={"auto confirm non-purchase transactions"}
          />
        </Section>

        <Section>
          <SectionHeader>Import and Export Map Data</SectionHeader>
          <Red>WARNING:</Red> Maps from others could be altered and are not
          guaranteed to be correct!
          <Spacer height={16} />
          <TextInput
            value={importMapByTextBoxValue}
            placeholder={"Paste map contents here"}
            onChange={(e: Event) =>
              setImportMapByTextBoxValue((e.target as HTMLInputElement).value)
            }
          />
          <Spacer height={8} />
          <Btn
            size="stretch"
            onClick={onImportMapFromTextBox}
            disabled={importMapByTextBoxValue.length === 0}
          >
            Import Map From Above
          </Btn>
          <Spacer height={8} />
          <Btn size="stretch" onClick={onExportMap}>
            Copy Map to Clipboard
          </Btn>
          <Spacer height={8} />
          <Btn size="stretch" onClick={onImportMap}>
            Import Map from Clipboard
          </Btn>
          <Spacer height={8} />
          <Green>{success}</Green>
          <Red>{failure}</Red>
        </Section>

        {/* RPC endpoint section removed: Aztec node connection is configured at startup */}

        <Section>
          <SectionHeader>Metrics Opt Out</SectionHeader>
          We collect a minimal set of data and statistics such as SNARK proving
          times, average transaction times across browsers, and{" "}
          {CHAIN_DISPLAY_NAME} transaction errors, to help us optimize
          performance and fix bugs. This does not include personal data like
          email or IP address.
          <Spacer height={8} />
          <BooleanSetting
            uiManager={uiManager}
            setting={Setting.OptOutMetrics}
            settingDescription="metrics opt out"
          />
        </Section>

        <Section>
          <SectionHeader>Performance</SectionHeader>
          High performance mode turns off background rendering, and reduces the
          detail at which smaller planets are rendered.
          <Spacer height={8} />
          <BooleanSetting
            uiManager={uiManager}
            setting={Setting.HighPerformanceRendering}
            settingDescription="high performance mode"
          />
          <Spacer height={8} />
          <BooleanSetting
            uiManager={uiManager}
            setting={Setting.DisableEmojiRendering}
            settingDescription="disable emoji rendering"
          />
          <Spacer height={8} />
          <BooleanSetting
            uiManager={uiManager}
            setting={Setting.DisableHatRendering}
            settingDescription="disable hat rendering"
          />
        </Section>

        <Section>
          <SectionHeader>Notifications</SectionHeader>
          <Spacer height={8} />
          <BooleanSetting
            uiManager={uiManager}
            setting={Setting.MoveNotifications}
            settingDescription="show notifications for move transactions"
          />
          <Spacer height={8} />
          Auto clear transaction confirmation notifications after this many
          seconds. Set to a negative number to not auto-clear.
          <Spacer height={8} />
          <NumberSetting
            uiManager={uiManager}
            setting={Setting.AutoClearConfirmedTransactionsAfterSeconds}
          />
          <Spacer height={8} />
          Auto clear transaction rejection notifications after this many
          seconds. Set to a negative number to not auto-clear.
          <NumberSetting
            uiManager={uiManager}
            setting={Setting.AutoClearRejectedTransactionsAfterSeconds}
          />
        </Section>

        <Section>
          <SectionHeader>Scroll speed</SectionHeader>
          <Spacer height={8} />
          <Slider
            variant="filled"
            editable={true}
            labelVisibility="none"
            value={scrollSpeed}
            min={SCROLL_MIN}
            max={SCROLL_MAX}
            step={SCROLL_MIN / 10}
            onChange={onScrollChange}
          />
        </Section>

        <Section>
          <SectionHeader>Reset Tutorial</SectionHeader>
          <Spacer height={8} />
          <Btn
            size="stretch"
            onClick={() => TutorialManager.getInstance(uiManager).reset()}
          >
            Reset Tutorial
          </Btn>
        </Section>

        <Section>
          <SectionHeader>Disable Default Shortcuts</SectionHeader>
          If you'd like to use custom shortcuts via a plugin, you can disable
          the default shortcuts here.
          <Spacer height={8} />
          <BooleanSetting
            uiManager={uiManager}
            setting={Setting.DisableDefaultShortcuts}
            settingDescription="toggle disable default shortcuts"
          />
        </Section>

        <Section>
          <SectionHeader>Enable Experimental Features</SectionHeader>
          Features that aren't quite ready for production but we think are cool.
          <Spacer height={8} />
          <BooleanSetting
            uiManager={uiManager}
            setting={Setting.ExperimentalFeatures}
            settingDescription="toggle expeirmental features"
          />
        </Section>

        <Section>
          <SectionHeader>Renderer Settings</SectionHeader>
          Some options for the default renderer which is included with the game.
          <Spacer height={8} />
          <BooleanSetting
            uiManager={uiManager}
            setting={Setting.DisableFancySpaceEffect}
            settingDescription="disable fancy space shaders"
          />
          <Spacer height={8} />
          <ColorSetting
            uiManager={uiManager}
            setting={Setting.RendererColorInnerNebula}
            settingDescription="inner nebula color"
          />
          <ColorSetting
            uiManager={uiManager}
            setting={Setting.RendererColorNebula}
            settingDescription="nebula color"
          />
          <ColorSetting
            uiManager={uiManager}
            setting={Setting.RendererColorSpace}
            settingDescription="space color"
          />
          <ColorSetting
            uiManager={uiManager}
            setting={Setting.RendererColorDeepSpace}
            settingDescription="deep space color"
          />
          <ColorSetting
            uiManager={uiManager}
            setting={Setting.RendererColorDeadSpace}
            settingDescription="dead space color"
          />
        </Section>
      </SettingsContent>
    </ModalPane>
  );
}

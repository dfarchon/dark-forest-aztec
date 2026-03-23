/**
 * WalletManager test page.
 *
 * Demonstrates the full lifecycle:
 *  1. createWalletManager() factory — mirrors createEthConnection()
 *  2. Account management — create, switch, remove, import
 *  3. walletChanged$ / myBalance$ reactive streams
 *  4. KeyStore persistence (localStorage)
 */

import "./TestPageStyles.css";

import * as React from "react";

import {
  getEffectiveNodeUrl,
  getEffectiveProverUrl,
} from "../../../config/connection";
import { getProverEnabled } from "../../../config/env";
import {
  type AccountRecord,
  createWalletManager,
  type WalletManagerConfig,
} from "../../../Session/WalletManager";
import { TextPreview } from "../../Components/TextPreview";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str: string, head = 8, tail = 6): string {
  if (str.length <= head + tail) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

// ---------------------------------------------------------------------------
// Shared UI components
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="test-page__section">
      <button
        type="button"
        className="test-page__section-header"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`test-page__section-chevron ${open ? "open" : ""}`}>
          ▶
        </span>
        {title}
      </button>
      {open ? <div className="test-page__section-body">{children}</div> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function WalletManagerTestPage() {
  const mgrRef = React.useRef<Awaited<
    ReturnType<typeof createWalletManager>
  > | null>(null);
  const walletSubRef = React.useRef<{ unsubscribe: () => void } | null>(null);
  const balanceSubRef = React.useRef<{ unsubscribe: () => void } | null>(null);

  const [connected, setConnected] = React.useState(false);
  const [activeAddress, setActiveAddress] = React.useState<string | undefined>(
    undefined
  );
  const [accounts, setAccounts] = React.useState<AccountRecord[]>([]);
  const [balance, setBalance] = React.useState<bigint>(0n);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<string | null>(null);
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0);

  // Create account form
  const [newLabel, setNewLabel] = React.useState("");

  // Import account form
  const [importSecretKey, setImportSecretKey] = React.useState("");
  const [importSalt, setImportSalt] = React.useState("");
  const [importSigningKey, setImportSigningKey] = React.useState("");
  const [importLabel, setImportLabel] = React.useState("");

  React.useEffect(() => {
    let destroyed = false;

    const config: WalletManagerConfig = {
      nodeUrl: getEffectiveNodeUrl(),
      storagePrefix: "dfpunk",
      balancePollIntervalMs: 15_000,
      proverUrl: getEffectiveProverUrl(),
      pxeConfig: {
        proverEnabled: getProverEnabled(),
      },
    };

    createWalletManager(config)
      .then((mgr) => {
        if (destroyed) {
          mgr.destroy();
          return;
        }
        mgrRef.current = mgr;
        setConnected(true);
        setActiveAddress(mgr.getActiveAddress()?.toString());
        setAccounts(mgr.getAccounts());
        setError(null);

        mgr.getBalance().then((b) => setBalance(b));

        const walletSub = mgr.walletChanged$.subscribe((addr) => {
          setActiveAddress(addr?.toString());
          setAccounts(mgr.getAccounts());
          forceRender();
        });

        const balanceSub = mgr.myBalance$.subscribe((b) => {
          setBalance(b);
        });

        walletSubRef.current = walletSub;
        balanceSubRef.current = balanceSub;
      })
      .catch((err) => {
        if (!destroyed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      destroyed = true;
      walletSubRef.current?.unsubscribe();
      balanceSubRef.current?.unsubscribe();
      walletSubRef.current = null;
      balanceSubRef.current = null;
      const mgr = mgrRef.current;
      if (mgr) {
        mgr.destroy();
        mgrRef.current = null;
      }
      setConnected(false);
      setActiveAddress(undefined);
      setAccounts([]);
    };
  }, []);

  const handleCreateAccount = async () => {
    const mgr = mgrRef.current;
    if (!mgr) return;
    setLoading("Creating account…");
    setError(null);
    try {
      await mgr.createAccount(newLabel || undefined);
      setNewLabel("");
      setAccounts(mgr.getAccounts());
      setActiveAddress(mgr.getActiveAddress()?.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const handleSwitchAccount = async (address: string) => {
    const mgr = mgrRef.current;
    if (!mgr) return;
    setLoading(`Switching to ${truncate(address)}…`);
    setError(null);
    try {
      await mgr.switchAccount(address);
      setActiveAddress(mgr.getActiveAddress()?.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const handleRemoveAccount = (address: string) => {
    const mgr = mgrRef.current;
    if (!mgr) return;

    const confirmed = confirm(`Remove account ${truncate(address)}?`);
    if (!confirmed) return;

    mgr.removeAccount(address);
    setAccounts(mgr.getAccounts());
    setActiveAddress(mgr.getActiveAddress()?.toString());
  };

  const handleImportAccount = async () => {
    const mgr = mgrRef.current;
    if (!mgr || !importSecretKey || !importSalt || !importSigningKey) return;
    setLoading("Importing account…");
    setError(null);
    try {
      await mgr.importAccount(
        importSecretKey.trim(),
        importSalt.trim(),
        importSigningKey.trim(),
        importLabel || undefined
      );
      setImportSecretKey("");
      setImportSalt("");
      setImportSigningKey("");
      setImportLabel("");
      setAccounts(mgr.getAccounts());
      setActiveAddress(mgr.getActiveAddress()?.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const handleRefreshBalance = async () => {
    const mgr = mgrRef.current;
    if (!mgr) return;
    setLoading("Refreshing balance…");
    try {
      await mgr.getBalance();
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="test-page">
      <header className="test-page__header">
        <h1 className="test-page__title">WalletManager Demo</h1>
        <nav className="test-page__nav">
          <a href="/">← Home</a>
          <span className="test-page__nav-sep">·</span>
          <a href="/test/indexer">Indexer</a>
          <span className="test-page__nav-sep">·</span>
          <a href="/test/tx-executor">TxExecutor</a>
        </nav>
      </header>

      {error && (
        <div className="test-page__error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && <div className="test-page__loading">{loading}</div>}

      {/* 1. Connection Status */}
      <Section title="Connection Status" defaultOpen={true}>
        <div className="test-page__stats">
          <div className="test-page__stat">
            <div className="test-page__stat-label">Connected</div>
            <div className="test-page__stat-value">
              <span
                className={`test-page__badge ${connected ? "test-page__badge--success" : "test-page__badge--idle"}`}
              >
                {connected ? "Yes" : "No"}
              </span>
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">Node URL</div>
            <div className="test-page__stat-value">
              <code style={{ fontSize: "0.85rem" }}>
                {getEffectiveNodeUrl()}
              </code>
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">PXE prover enabled</div>
            <div className="test-page__stat-value">
              <span
                className={`test-page__badge ${getProverEnabled() ? "test-page__badge--success" : "test-page__badge--idle"}`}
              >
                {getProverEnabled() ? "Yes" : "No"}
              </span>
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">Accelerator URL</div>
            <div className="test-page__stat-value">
              <code style={{ fontSize: "0.85rem" }}>
                {getEffectiveProverUrl()}
              </code>
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">Native accelerator path</div>
            <div className="test-page__stat-value">
              <span
                className={`test-page__badge ${getProverEnabled() ? "test-page__badge--success" : "test-page__badge--idle"}`}
              >
                {getProverEnabled()
                  ? "Active (when proving)"
                  : "Off (PXE prover disabled)"}
              </span>
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">Active address</div>
            <div className="test-page__stat-value">
              {activeAddress ? (
                <TextPreview
                  text={activeAddress}
                  unFocusedWidth="120px"
                  focusedWidth="200px"
                />
              ) : (
                "—"
              )}
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">FeeJuice balance</div>
            <div className="test-page__stat-value">{String(balance)}</div>
          </div>
        </div>
        {connected && (
          <button
            type="button"
            className="test-page__btn test-page__btn--secondary"
            onClick={handleRefreshBalance}
            disabled={!!loading}
          >
            Refresh balance
          </button>
        )}
      </Section>

      {/* 2. Create Account */}
      <Section title="Create Account" defaultOpen={true}>
        <div className="test-page__form-group">
          <label className="test-page__form-label">Label (optional)</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="My account"
          />
        </div>
        <button
          type="button"
          className="test-page__btn test-page__btn--primary"
          onClick={handleCreateAccount}
          disabled={!connected || !!loading}
        >
          Create new account
        </button>
      </Section>

      {/* 3. Import Account */}
      <Section title="Import Account" defaultOpen={false}>
        <div className="test-page__form-group">
          <label className="test-page__form-label">Secret key</label>
          <input
            type="text"
            className="test-page__form-input"
            value={importSecretKey}
            onChange={(e) => setImportSecretKey(e.target.value)}
            placeholder="0x..."
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">Salt</label>
          <input
            type="text"
            className="test-page__form-input"
            value={importSalt}
            onChange={(e) => setImportSalt(e.target.value)}
            placeholder="0x..."
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">Signing key (hex)</label>
          <input
            type="text"
            className="test-page__form-input"
            value={importSigningKey}
            onChange={(e) => setImportSigningKey(e.target.value)}
            placeholder="hex string"
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">Label (optional)</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={importLabel}
            onChange={(e) => setImportLabel(e.target.value)}
            placeholder="Imported account"
          />
        </div>
        <button
          type="button"
          className="test-page__btn test-page__btn--primary"
          onClick={handleImportAccount}
          disabled={
            !connected ||
            !!loading ||
            !importSecretKey.trim() ||
            !importSalt.trim() ||
            !importSigningKey.trim()
          }
        >
          Import account
        </button>
      </Section>

      {/* 4. Account List */}
      <Section title="Accounts" defaultOpen={true}>
        {accounts.length === 0 ? (
          <div className="test-page__empty">
            No accounts yet. Create one above.
          </div>
        ) : (
          <div className="test-page__table-wrap">
            <table className="test-page__table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Label</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc) => (
                  <tr key={acc.address}>
                    <td>
                      <TextPreview
                        text={acc.address}
                        unFocusedWidth="120px"
                        focusedWidth="200px"
                      />
                      {acc.address === activeAddress && (
                        <span
                          className="test-page__badge test-page__badge--active"
                          style={{ marginLeft: "0.5rem" }}
                        >
                          active
                        </span>
                      )}
                    </td>
                    <td>{acc.label ?? "—"}</td>
                    <td>{new Date(acc.createdAt).toLocaleString()}</td>
                    <td>
                      {acc.address !== activeAddress && (
                        <button
                          type="button"
                          className="test-page__btn test-page__btn--secondary"
                          onClick={() => handleSwitchAccount(acc.address)}
                          disabled={!!loading}
                        >
                          Switch
                        </button>
                      )}
                      <button
                        type="button"
                        className="test-page__btn test-page__btn--danger"
                        onClick={() => handleRemoveAccount(acc.address)}
                        disabled={!!loading}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

# External Wallet Guide

This guide explains how to connect DFPunk to the demo Aztec external wallet.

The recommended happy path is:

- use the demo wallet repo `https://github.com/dfarchon/aztec-wallet-demo`
- keep the wallet on `Testnet`
- open either:
  - a hosted DFPunk frontend that already targets testnet, or
  - a local DFPunk frontend that you have configured to target testnet

The wallet and the DFPunk frontend must point at the same Aztec network. If they do not match, wallet discovery and connection will fail or behave inconsistently.

## Prerequisites

- Node.js and Yarn installed for the demo wallet repo
- Access to the demo wallet repo: `https://github.com/dfarchon/aztec-wallet-demo`
- A Chromium-based browser started by the wallet extension dev server
- A DFPunk frontend that is connected to testnet
- If you are running the demo wallet in Chrome dev mode, native messaging may need to be installed first. The demo wallet README documents the platform-specific setup:
  - `https://github.com/dfarchon/aztec-wallet-demo`

## 1. Start the Demo Wallet App

Run the Electron wallet app from the `app/` workspace:

```bash
cd aztec-wallet-demo/app
yarn install
yarn build:native-host
yarn start
```

Expected result:

- the Electron wallet app opens
- if Chrome native messaging is not installed, the wallet may prompt you to fix that first

## 2. Start the Wallet Extension Browser

In a second terminal, start the browser extension from the `extension/` workspace:

```bash
cd aztec-wallet-demo/extension
yarn install
yarn dev
```

Expected result:

- a Chromium browser launches with the demo wallet extension preloaded

Use this browser window for DFPunk. Do not switch to a different browser profile after the extension is loaded.

## 3. Prepare the Account in the Demo Wallet

Complete the wallet-side setup before trying to enter the game.

1. Open the demo wallet app.
2. Confirm the selected network is `Testnet`.
3. Create a new account.
4. Copy or note the new account address.
5. Fund the address with FeeJuice by using the GregoJuice funding link shown by the wallet UI.
6. After funding arrives, run `Deploy`.
7. If deployment does not complete on the first funded attempt, follow the wallet's guidance and retry `Deploy`.
8. Wait until the account status is `Deployed`.

## 4. Open DFPunk in the Extension Browser

Open DFPunk in the browser window that was launched by `yarn dev`.

Two common entry modes:

- Hosted frontend:
  - open a DFPunk frontend URL that is configured for testnet in the extension browser
- Local frontend:
  - start a local DFPunk frontend that is configured for testnet
  - open that local URL in the extension browser

What matters is not whether the frontend is local or hosted. What matters is that it targets the same network as the wallet.

## 5. Connect the External Wallet in DFPunk

On the DFPunk game page, follow the terminal-style onboarding flow:

1. choose `extension wallet`
2. choose `connect extension wallet`
3. wait for wallet discovery
4. select the detected wallet provider
5. compare the emoji verification sequence
6. approve the secure channel / connection prompt in the wallet extension
7. approve the DFPunk capability request
8. select the granted account
9. continue into the game

The DFPunk capability request includes the permissions it needs for gameplay. The critical ones are:

- accounts
- simulation
- transaction

If you deny those permissions, DFPunk will not be able to complete external-wallet startup.

## Quickstart Checklist

1. Start the demo wallet app.
2. Start the extension browser.
3. Keep the wallet on `Testnet`.
4. Create an account.
5. Fund the account with FeeJuice from the wallet's GregoJuice link.
6. Run `Deploy`.
7. Retry `Deploy` if the wallet still indicates the account is not ready.
8. Open DFPunk in the extension browser.
9. Use either:
   - a hosted testnet frontend, or
   - a local frontend configured for testnet
10. Choose `extension wallet` in DFPunk.
11. Approve the wallet connection and permissions.
12. Select the deployed account.

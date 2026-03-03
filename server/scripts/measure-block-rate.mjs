function parseArgs(argv) {
  const args = {
    serverUrl: process.env.SERVER_URL ?? "http://localhost:3001",
    durationSec: 60,
    pollMs: 1000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    if (key === "--server-url" && next) {
      args.serverUrl = next;
      i += 1;
      continue;
    }
    if (key === "--duration-sec" && next) {
      args.durationSec = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (key === "--poll-ms" && next) {
      args.pollMs = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
  }

  if (!Number.isFinite(args.durationSec) || args.durationSec <= 0) {
    throw new Error("--duration-sec must be a positive integer");
  }
  if (!Number.isFinite(args.pollMs) || args.pollMs <= 0) {
    throw new Error("--poll-ms must be a positive integer");
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLatestBlock(serverUrl) {
  const res = await fetch(`${serverUrl}/blocks/latest`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} for /blocks/latest: ${body}`);
  }
  const json = await res.json();
  return Number(json.blockNumber);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const startTs = Date.now();
  const endTs = startTs + config.durationSec * 1000;
  let startBlock = await fetchLatestBlock(config.serverUrl);
  let lastBlock = startBlock;
  let changes = 0;
  const changeTimes = [];

  console.log("[block-rate] Measuring...");
  console.log(`  serverUrl:   ${config.serverUrl}`);
  console.log(`  durationSec: ${config.durationSec}`);
  console.log(`  pollMs:      ${config.pollMs}`);
  console.log(`  startBlock:  ${startBlock}`);

  while (Date.now() < endTs) {
    await sleep(config.pollMs);
    const current = await fetchLatestBlock(config.serverUrl);
    if (current > lastBlock) {
      const delta = current - lastBlock;
      for (let i = 0; i < delta; i += 1) {
        changeTimes.push(Date.now());
      }
      changes += delta;
      lastBlock = current;
    }
  }

  const elapsedSec = (Date.now() - startTs) / 1000;
  const produced = lastBlock - startBlock;
  const blocksPerSec = produced > 0 ? produced / elapsedSec : 0;
  const secPerBlock = produced > 0 ? elapsedSec / produced : null;

  console.log("[block-rate] Result");
  console.log(`  elapsedSec:  ${elapsedSec.toFixed(2)}`);
  console.log(`  endBlock:    ${lastBlock}`);
  console.log(`  produced:    ${produced}`);
  console.log(`  changesSeen: ${changes}`);
  console.log(`  blocksPerSec:${blocksPerSec.toFixed(4)}`);
  console.log(`  secPerBlock: ${secPerBlock == null ? "n/a" : secPerBlock.toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

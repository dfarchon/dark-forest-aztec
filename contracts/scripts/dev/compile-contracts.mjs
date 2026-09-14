import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

assert.equal(process.argv.length, 2, 'This build command takes no arguments');

const scripts = path.dirname(fileURLToPath(import.meta.url));
const contracts = path.resolve(scripts, '../..');
const version = JSON.parse(fs.readFileSync(path.join(contracts, '../package.json'))).dependencies['@aztec/stdlib'];
assert.equal(version, '5.0.1');
const builder = fileURLToPath(import.meta.resolve('@aztec/builder/cli'));
assert.equal(JSON.parse(fs.readFileSync(path.resolve(path.dirname(builder), '../../package.json'))).version, version);
const buildRoot = path.resolve(process.env.DF_BUILD_ROOT ?? os.tmpdir());
assert(buildRoot !== contracts && !buildRoot.startsWith(contracts + path.sep), 'Build directory must be outside the contracts workspace');
fs.mkdirSync(buildRoot, {recursive: true});
const work = fs.mkdtempSync(path.join(buildRoot, 'dark-forest-build-'));
const staged = path.join(work, 'contracts');
const env = {...process.env, RAYON_NUM_THREADS: '2', HARDWARE_CONCURRENCY: '2'};
function run(command, args, cwd = staged) {
  const result = spawnSync(command, args, {cwd, env, stdio: 'inherit'});
  assert.equal(result.status, 0, `${command} failed; build retained at ${work}: ${result.error ?? ''}`);
}
function copyNoir(from, to) {
  fs.mkdirSync(to, {recursive: true});
  for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
    if (['target', 'node_modules', '.git'].includes(entry.name)) continue;
    assert(!entry.isSymbolicLink(), `Unexpected dependency symlink: ${from}/${entry.name}`);
    if (entry.isDirectory()) copyNoir(path.join(from, entry.name), path.join(to, entry.name));
    else if (entry.name.endsWith('.nr') || entry.name === 'Nargo.toml')
      fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
  }
}
copyNoir(contracts, staged);
function checkVersion(command, expected) {
  const result = spawnSync(command, ['--version'], {encoding: 'utf8'});
  assert(result.status === 0 && result.stdout.split(/\r?\n/).includes(expected), `Aztec ${version} requires ${command}: ${expected}`);
}
if (!process.env.DF_NARGO) checkVersion('aztec-nargo', 'noirc version = 1.0.0-beta.22+c57152f91260ecdb9faad4efc20abb14b6d2ece7');
if (!process.env.DF_NATIVE_PROCESSOR) checkVersion('bb', version);
const {loadContractArtifact} = await import('@aztec/stdlib/abi');
const {getContractClassFromArtifact} = await import('@aztec/stdlib/contract');
const {MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES, MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS} = await import('@aztec/constants');
const facades = ['world:World', 'player:Player', 'planet:Planet', 'planet_revealed_coords:PlanetRevealedCoords',
  'planet_events:PlanetEvents', 'planet_artifacts:PlanetArtifacts', 'arrival:Arrival',
  'artifact:Artifact', 'artifact_location:ArtifactLocation'].map(entry => `${entry}Storage`);
const pxeRequire = createRequire(import.meta.resolve('@aztec/pxe/server'));
const opcodeModule = pathToFileURL(pxeRequire.resolve('@aztec/simulator/public/avm/opcodes'));
assert.equal(JSON.parse(fs.readFileSync(new URL('../../../../package.json', opcodeModule))).version, version);
const {Call, StaticCall} = await import(opcodeModule);
const {decodeFromBytecode} = await import(new URL('../serialization/bytecode_serialization.js', opcodeModule));
function assertImmutableClass(artifact) {
  assert(artifact.functions.every(fn => fn.is_unconstrained === true), `${artifact.name}: canonical cache forbids private functions`);
  const dispatch = artifact.functions.find(fn => fn.name === 'public_dispatch');
  assert(dispatch, `${artifact.name}: missing public dispatcher`);
  const instructions = decodeFromBytecode(Buffer.from(dispatch.bytecode, 'base64'));
  assert(!instructions.some(op => op instanceof Call || op instanceof StaticCall), `${artifact.name}: canonical cache forbids external calls`);
}
// Direct reads in types/storage/state.nr must match the recognized contract layout.
function assertStorageLayout(artifact) {
  const expected = artifact.name === 'Config' ? {
    world_config_hash: 286, snark_config_hash: 287, game_config_core_hash: 288,
    planet_level_thresholds_hash: 289, planet_type_weights_tier_0_hash: 290,
    planet_type_weights_tier_1_hash: 291, planet_type_weights_tier_2_hash: 292,
    planet_type_weights_tier_3_hash: 293, artifacts_config_hash: 294,
    space_junk_config_hash: 296, planet_default_stats_hash: 299,
  } : {admin: 1, authorized_map: 2, state_roots: 6};
  for (const [field, slot] of Object.entries(expected))
    assert.equal(Number(artifact.storageLayout[field]?.slot), slot, `${artifact.name}.${field}: direct-read storage slot changed`);
}
const systems = ['admin:Admin', 'core:Core', 'move:Move', 'artifact_action:ArtifactAction',
  'artifact_find:ArtifactFind', 'artifact_prospect:ArtifactProspect', 'artifact_valut:ArtifactValut'];
const classes = new Map(), output = path.join(work, 'final');
fs.mkdirSync(output);
async function compile(entry) {
  run(process.env.DF_NARGO ?? 'aztec-nargo', ['compile', '--package', entry.split(':')[0], '--force']);
  const name = entry.replace(':', '-') + '.json', raw = path.join(staged, 'target', name);
  const canonical = entry === 'config:Config' || facades.includes(entry);
  if (canonical) assert(JSON.parse(fs.readFileSync(raw, 'utf8')).functions.every(fn => fn.is_unconstrained === true), `${entry}: canonical cache forbids private functions`);
  run(process.env.DF_NATIVE_PROCESSOR ?? 'bb', ['aztec_process', '-i', raw]);
  const artifact = JSON.parse(fs.readFileSync(raw, 'utf8'));
  assert.equal(artifact.transpiled, true);
  assert(!artifact.aztec_version || artifact.aztec_version === version, 'Artifact SDK version differs');
  artifact.aztec_version = version;
  const dispatch = artifact.functions.filter(fn => fn.name === 'public_dispatch');
  assert.equal(dispatch.length, 1);
  const bytes = Buffer.from(dispatch[0].bytecode, 'base64').length;
  assert(bytes > 0 && bytes <= MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES, `${entry}: public bytecode too large`);
  assert(1 + Math.ceil(bytes / 31) <= MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS, `${entry}: packed bytecode too large`);
  if (canonical) assertImmutableClass(artifact);
  const loaded = loadContractArtifact(artifact);
  if (canonical) assertStorageLayout(loaded);
  const id = (await getContractClassFromArtifact(loaded)).id.toString();
  if (classes.has(entry)) assert.equal(id, classes.get(entry), `${entry}: class changed after binding`);
  else classes.set(entry, id);
  fs.writeFileSync(path.join(output, name), JSON.stringify(artifact));
}
await compile('config:Config');
for (const entry of facades) await compile(entry);
const bindings = path.join(staged, 'types/src/storage/state.nr');
let reader = fs.readFileSync(bindings, 'utf8');
for (const [pattern, value] of [
  [/pub global CONFIG_CLASS: Field = [^;]+;/, `pub global CONFIG_CLASS: Field = ${classes.get('config:Config')};`],
  [/^pub global FACADE_CLASSES: \[Field;\s*9\] = [^\n]+;$/m, `pub global FACADE_CLASSES: [Field; 9] = [${facades.map(entry => classes.get(entry)).join(', ')}];`],
]) {
  assert(pattern.test(reader), 'Missing class binding');
  reader = reader.replace(pattern, value);
}
fs.writeFileSync(bindings, reader);
// A facade must not depend on its own class ID through a shared helper.
for (const entry of ['config:Config', ...facades]) await compile(entry);
for (const entry of systems) await compile(entry);
const target = path.join(contracts, 'target');
fs.rmSync(target, {recursive: true, force: true});
fs.cpSync(output, target, {recursive: true});
console.log(`Built ${classes.size} contracts in ${target}; isolated source: ${staged}`);

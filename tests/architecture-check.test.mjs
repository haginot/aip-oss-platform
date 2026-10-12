import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkArchitecture, checkLicenseDeclarations, checkRecoveryContract } from '../scripts/architecture-check.mjs';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
function fixture() {
  const c = read('architecture/composition.json');
  const o = read('architecture/OSS_BASELINE.json');
  return [c, read('architecture/ROLE_CONTRACT_BASELINE.json'), o, read('architecture/SOURCE_BASELINE.json')];
}
test('complete fixed responsibilities accepted by metadata checker', () => assert.equal(checkArchitecture(...fixture()), true));
const mutations = {
  unapprovedComposition: ([c]) => { c.status = 'draft'; },
  omittedRole: ([c]) => c.roles.pop(),
  duplicateRole: ([c]) => { c.roles[1] = structuredClone(c.roles[0]); },
  omittedContract: ([c]) => { c.roles[0].contracts = ['unrelated API']; },
  missingOwner: ([c]) => { delete c.roles[0].owner; },
  unknownProduct: ([c]) => { c.roles[0].productRefs = ['unverified']; },
  mutableVersion: ([,,o]) => { o.products[0].version = 'latest'; },
  unresolvedLicense: ([,,o]) => { o.internalLicenseDecision.status = 'pending'; },
  falseRuntimeClaim: ([c]) => { c.roles[0].implementationStatus = 'implemented'; },
  missingUnsupportedRejection: ([c]) => { c.roles.find(x => x.status === 'not-needed').verification = ['silently ignore request']; },
  sourceDrift: ([,b]) => { b.sourceCatalogSha256 = '0'.repeat(64); },
};
for (const [name, mutate] of Object.entries(mutations)) test(`reject architecture defect: ${name}`, () => {
  const f = fixture(); mutate(f); assert.throws(() => checkArchitecture(...f));
});

function licenseFixture() {
  return [readFileSync('LICENSE', 'utf8'), read('package.json'), read('package-lock.json'), read('architecture/OSS_BASELINE.json')];
}
test('repository license declarations match the approved decision', () => assert.equal(checkLicenseDeclarations(...licenseFixture()), true));
for (const [name, mutate] of Object.entries({
  missingGrant: f => { f[0] = 'MIT License'; },
  packageMismatch: f => { f[1].license = 'UNLICENSED'; },
  lockMismatch: f => { f[2].packages[''].license = 'UNLICENSED'; },
  unapprovedLicense: f => { f[3].internalLicenseDecision.status = 'pending'; },
})) test(`reject license declaration defect: ${name}`, () => {
  const f = licenseFixture(); mutate(f); assert.throws(() => checkLicenseDeclarations(...f));
});

function recoveryFixture() {
  return [read('architecture/RECOVERY_CONTRACT.json'), read('architecture/composition.json'), readFileSync('docs/DECISIONS.md','utf8'), readFileSync('ops/BCP.md','utf8')];
}
test('recovery design declares retention, independent discovery and executable future counterexamples', () => assert.equal(checkRecoveryContract(...recoveryFixture()), true));
for (const [name, mutate] of Object.entries({
  expiredKey: ([c]) => { c.retention.actionKey = '30 days'; },
  missingInboxRetention: ([c]) => { delete c.retention.consumerInbox; },
  missingLedgerRetention: ([c]) => { delete c.retention.erpLedger; },
  absentMeansUnapplied: ([c]) => { c.retention.missingRecord = 'unapplied'; },
  sharedLossBoundary: ([c]) => { c.journal.storage = 'same Kernel DB'; },
  missingOperationMapping: ([c]) => { c.journal.fields = c.journal.fields.filter(x => x !== 'operationId'); },
  noEnumeration: ([c]) => { c.journal.enumeration = 'reconcile(operationId)'; },
  missingRecoveryRange: ([c]) => { delete c.journal.recoveryRange; },
  checkpointOnlyRecovery: ([c]) => { c.journal.recoveryRange = 'only journal records after checkpoint'; },
  checkpointWithoutDrain: ([c]) => { c.journal.recoveryRange = c.journal.recoveryRange.replace('DB transaction drain and ', ''); },
  unprovenRangeOptimization: ([c]) => { c.journal.recoveryRange = c.journal.recoveryRange.replace('only with proven complete union', 'allowed unconditionally'); },
  noFence: ([c]) => { c.journal.resendBeforeComplete = 'allowed'; },
  oracleDependency: ([c]) => { c.journal.oracleIndependent = false; },
  missingRestoreCase: ([c]) => { c.scenarios = c.scenarios.filter(x => x.id !== 'lost-ack-db-restore'); },
  missingRolePlan: ([,c]) => { c.roles.find(x => x.id === 'cdc').verification = ['unrelated plan']; },
  missingBcpLink: (f) => { f[3] = 'placeholder'; },
  checkpointOnlyDocument: f => { f[2] = f[2].replace('列挙対象の全sequence', 'checkpoint以降の全sequence'); },
  contradictoryDocument: f => { f[2] += '\ncheckpoint以降の全sequenceとhash chainを検査する。'; },
})) test(`reject recovery design defect: ${name}`, () => {
  const f = recoveryFixture(); mutate(f); assert.throws(() => checkRecoveryContract(...f));
});

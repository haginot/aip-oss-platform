import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function checkLicenseDeclarations(licenseText, pkg, lock, oss) {
  assert.equal(oss.internalLicenseDecision.status, 'approved');
  const license = oss.internalLicenseDecision.license;
  assert.equal(pkg.license, license, 'package license must match the approved decision');
  assert.equal(lock.packages?.['']?.license, license, 'lockfile root license must match the approved decision');
  if (license === 'MIT') {
    for (const phrase of ['MIT License', 'Permission is hereby granted, free of charge', 'The above copyright notice and this permission notice', 'THE SOFTWARE IS PROVIDED "AS IS"']) {
      assert.ok(licenseText.includes(phrase), `LICENSE lacks ${phrase}`);
    }
  } else {
    assert.equal(license, 'Apache-2.0');
    assert.match(licenseText, /Apache License\s+Version 2\.0/);
    assert.match(licenseText, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  }
  return true;
}

export function checkRecoveryContract(c, composition, decisions, bcp) {
  assert.equal(c.contractVersion, '1.0.0');
  assert.equal(c.status, 'approved');
  assert.equal(c.implementationStatus, 'planned');
  for (const name of ['actionKey', 'consumerInbox', 'erpLedger', 'recoveryJournal']) assert.equal(c.retention[name], 'indefinite', `retention missing: ${name}`);
  assert.equal(c.retention.keyReuse, 'never');
  assert.equal(c.retention.unresolvedHold, true);
  assert.equal(c.retention.missingRecord, 'unknown-not-unapplied');
  assert.equal(c.retention.expiryResponse, 'INCONSISTENT_STATE');
  assert.ok(c.retention.backupReplay.includes('blocked until reconciliation complete'));
  assert.equal(c.journal.port, 'RecoveryJournalPort');
  assert.match(c.journal.storage, /fsync.*separate volume.*excluded/);
  assert.match(c.journal.lossBoundary, /unsupported and fail closed/);
  for (const name of ['tenant','store','journalEpoch','sequence','actionId','idempotencyKey','canonicalDigest','actor','onBehalfOf','typedInput','expectedRevisions','evidenceRefs','definitionVersions','operationId','target','payloadDigest','phase','commitRevisions','previousHash','recordHash']) assert.ok(c.journal.fields.includes(name), `journal mapping missing: ${name}`);
  assert.match(c.journal.admission, /fsync intent before DB transaction; fsync committed marker after DB commit and before durable acknowledgement or external dispatch/);
  assert.match(c.journal.enumeration, /openSnapshot.*highWatermark.*list.*complete/);
  // A checkpoint cannot hide older operations still unresolved in a restored DB.
  assert.equal(c.journal.recoveryRange,
    'entire journal epoch union restored DB unresolved operations; checkpoint after admission fence, DB transaction drain and committed-marker fsync; afterSequence optimization only with proven complete union',
    'recovery range must preserve the full journal/DB union and checkpoint safety conditions');
  assert.match(c.journal.fence, /stop admission and dispatch.*contiguous chain/);
  assert.match(c.journal.authorization, /current trusted tenant\/store.*audit.*no business\/AI/);
  assert.equal(c.journal.gapResponse, 'INCONSISTENT_STATE');
  assert.equal(c.journal.resendBeforeComplete, 'blocked');
  assert.equal(c.journal.oracleIndependent, true);
  assert.match(c.journal.auditRecovery, /RecoveryObserved.*never invent/);
  const scenarios = new Map(c.scenarios.map(x => [x.id,x]));
  for (const id of ['retention-boundary','key-mismatch','missing-ledger','unresolved-hold','lost-ack-db-restore','intent-crash','journal-gap','recovery-denied']) {
    assert.ok(scenarios.has(id), `missing counterexample: ${id}`);
    assert.ok(scenarios.get(id).inject.length > 20 && scenarios.get(id).expect.length > 20);
  }
  assert.match(scenarios.get('lost-ack-db-restore').inject, /no controller ID input/);
  assert.match(scenarios.get('lost-ack-db-restore').expect, /no resend.*duplicate effect zero/);
  for (const id of ['action','event','writeback','recovery','cdc','audit','object-store']) {
    const r = composition.roles.find(x => x.id === id);
    assert.ok(r.contracts.some(x => x.includes('architecture/RECOVERY_CONTRACT.json')), `${id}: recovery contract not wired`);
    assert.ok(r.verification.some(x => x.includes('lost-ack-db-restore')), `${id}: recovery counterexample not planned`);
  }
  for (const doc of [decisions,bcp]) {
    assert.ok(doc.includes('architecture/RECOVERY_CONTRACT.json'));
    assert.ok(doc.includes('RecoveryJournalPort'));
    assert.ok(doc.includes('INCONSISTENT_STATE'));
  }
  assert.match(decisions, /列挙対象の全sequenceとhash chainを検査する/, 'journal integrity checks must cover the complete enumeration range');
  assert.doesNotMatch(decisions, /checkpoint以降の全sequence/, 'checkpoint-only integrity checks omit earlier unresolved operations');
  return true;
}

export function checkArchitecture(composition, baseline, oss, sourceBaseline) {
  assert.equal(composition.status, 'approved', 'architecture adoption has not been approved');
  assert.equal(oss.internalLicenseDecision.status, 'approved', 'internal license requires explicit approval');
  assert.ok(['MIT', 'Apache-2.0'].includes(oss.internalLicenseDecision.license));
  assert.equal(baseline.roles.length, 47);
  assert.equal(baseline.sourceCatalogSha256, sourceBaseline.files.find(x => x.path === 'capability-catalog.json').sha256);
  assert.equal(sourceBaseline.runtimeDependency, false);
  assert.deepEqual(composition.roles.map(x => x.id).sort(), baseline.roles.map(x => x.id).sort(), 'all 47 source responsibilities must appear exactly once');
  const products = new Map(oss.products.map(x => [x.id, x]));
  for (const product of products.values()) {
    assert.match(product.version, product.id === 'postgresql' ? /^\d+\.\d+$/ : /^\d+\.\d+\.\d+$/);
    for (const field of ['license', 'versionSource', 'licenseSource']) assert.ok(product[field]?.trim().length >= 3);
    assert.match(product.versionSource, /^https:\/\//);
    assert.match(product.licenseSource, /^https:\/\//);
  }
  assert.equal(composition.deployables.length, 3, 'initial deployment boundary changed; re-review required');
  for (const role of composition.roles) {
    const original = baseline.roles.find(x => x.id === role.id);
    assert.equal(role.group, original.group);
    assert.equal(role.sourceResponsibility, original.responsibility);
    assert.equal(role.migration, original.migration);
    assert.ok(role.contracts.includes(original.contract), `${role.id}: original public contract missing`);
    assert.ok(['selected', 'provided', 'not-needed'].includes(role.status));
    for (const field of ['implementation', 'version', 'license', 'owner', 'reason', 'contractVersion']) {
      assert.ok(typeof role[field] === 'string' && role[field].trim().length >= 2, `${role.id}: missing ${field}`);
      assert.doesNotMatch(role[field], /PENDING|undecided|TBD|TODO/);
    }
    assert.equal(role.implementationStatus, 'planned', 'architecture must not claim runtime completion');
    assert.ok(role.verification.length > 0 && role.verification.every(x => typeof x === 'string' && x.length > 10));
    assert.ok(Array.isArray(role.productRefs));
    for (const ref of role.productRefs) assert.ok(products.has(ref), `${role.id}: unverified product ${ref}`);
    if (role.status === 'not-needed') {
      assert.equal(role.productRefs.length, 0);
      assert.ok(role.reason.length > 40);
      assert.ok(role.verification.some(x => x.includes('UNSUPPORTED_CAPABILITY')));
    } else {
      assert.ok(role.license.includes(oss.internalLicenseDecision.license), `${role.id}: internal license mismatch`);
      assert.ok(role.productRefs.length > 0);
    }
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = p => JSON.parse(readFileSync(p, 'utf8'));
  const composition = read('architecture/composition.json');
  assert.equal(composition.sourceContractDigest, createHash('sha256').update(readFileSync('architecture/ROLE_CONTRACT_BASELINE.json')).digest('hex'));
  checkArchitecture(composition, read('architecture/ROLE_CONTRACT_BASELINE.json'), read('architecture/OSS_BASELINE.json'), read('architecture/SOURCE_BASELINE.json'));
  checkLicenseDeclarations(readFileSync('LICENSE', 'utf8'), read('package.json'), read('package-lock.json'), read('architecture/OSS_BASELINE.json'));
  checkRecoveryContract(read('architecture/RECOVERY_CONTRACT.json'), composition, readFileSync('docs/DECISIONS.md', 'utf8'), readFileSync('ops/BCP.md', 'utf8'));
  console.log('Architecture coverage, source contract snapshot and adoption metadata verified; product AC verdicts are unchanged.');
}

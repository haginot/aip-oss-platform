// Installed beside the existing project execution lock. No replacement identity.
import { getProcessIdentity, hasProcessIdentityMismatch, sameProcessIdentity } from './process.js';
import { isRecordedProcessAlive } from '../fs/file-lock.js';

const heldLocks = new Set();
export const registerExecutionLock = lock => heldLocks.add(lock);
export const unregisterExecutionLock = lock => heldLocks.delete(lock);

export function parseGateGroups(value) {
  if (!Array.isArray(value) || value.some(group => !group || !Number.isSafeInteger(group.pid)
    || group.pid <= 1 || !sameProcessIdentity(group.processIdentity, group.processIdentity))) {
    throw new Error('Invalid project execution gate groups');
  }
  return value.map(group => ({ pid: group.pid, processIdentity: { ...group.processIdentity } }));
}

export function isGateGroupAlive(group) {
  // A surviving group pins its PGID even after its original leader dies. A
  // positively identified reused leader proves this is no longer our group.
  if (hasProcessIdentityMismatch(group.processIdentity, getProcessIdentity(group.pid))) return false;
  try { process.kill(-group.pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error; // Unknown is never permission to reclaim the execution lock.
  }
}

export function isExecutionOwnerActive(owner) {
  return (owner.executionFinished !== true && isRecordedProcessAlive(owner.pid, owner.processIdentity))
    || (owner.gateGroups ?? []).some(isGateGroupAlive);
}

export function registerProjectExecutionGate(pid) {
  if (heldLocks.size === 0) return; // Standalone gate API has no execution owner.
  if (heldLocks.size !== 1) throw new Error('Command gate has ambiguous project execution ownership');
  const processIdentity = getProcessIdentity(pid);
  if (!processIdentity) throw new Error('Cannot register gate: process start time is unavailable');
  const group = parseGateGroups([{ pid, processIdentity }])[0];
  // Atomic, fsynced owner record publication MUST precede the start IPC message.
  [...heldLocks][0].registerGate(group);
}

export async function waitForProjectExecutionGate(pid) {
  const group = [...heldLocks].flatMap(lock => lock.owner.gateGroups ?? []).find(group => group.pid === pid);
  if (!group) return;
  const deadline = Date.now() + 10000;
  while (isGateGroupAlive(group)) {
    if (Date.now() >= deadline) throw new Error('Gate group cleanup did not finish; execution lock retained');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

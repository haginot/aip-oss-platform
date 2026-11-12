import {readFile} from 'node:fs/promises';
import {invoiceManifest} from '../../src/enterprise/invoice.mjs';
// Schema bootstrap only. Suppliers, orders, receipts, accounts, invoices and
// payments are created through the public commands, never through this owner.
export async function initializeInvoice(f){
 await f.owner.query(await readFile(new URL('../../migrations/008-enterprise-invoice.sql',import.meta.url),'utf8'));
 await f.owner.query('GRANT SELECT,INSERT,UPDATE,DELETE ON enterprise_invoice TO foundation_app');
}
export async function publishInvoice(f,call=f.call){
 await call('manager','install',{manifest:structuredClone(invoiceManifest)});
 await call('reviewer','review',{id:invoiceManifest.id,version:invoiceManifest.version});
 await call('publisher','publish',{id:invoiceManifest.id,version:invoiceManifest.version});
}

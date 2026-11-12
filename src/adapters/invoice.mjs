// All invoice SQL stays behind the existing StatePort transaction.
export class InvoiceRepository {
 constructor(r){this.r=r;}
 get(tenant,id){return this.r.one('SELECT * FROM enterprise_invoice WHERE tenant=$1 AND id=$2 FOR UPDATE',[tenant,id]);}
 async save(x,actionId){await this.r.query('INSERT INTO enterprise_invoice VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant,id) DO UPDATE SET revision=$4,data=$5,action_id=$6',[x.tenant,x.id,x.kind,x.revision,JSON.stringify(x.data),actionId]);}
 duplicate(tenant,supplier,number){return this.r.one("SELECT id FROM enterprise_invoice WHERE tenant=$1 AND kind='invoice' AND data->>'supplierId'=$2 AND data->>'normalizedNumber'=$3",[tenant,supplier,number]);}
 payments(tenant){return this.r.query("SELECT * FROM enterprise_invoice WHERE tenant=$1 AND kind='payment' ORDER BY id FOR UPDATE",[tenant]);}
}

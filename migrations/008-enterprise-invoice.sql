-- Additive invoice state. Business writes remain in public Action transactions.
CREATE TABLE enterprise_invoice (
 tenant text NOT NULL, id text NOT NULL REFERENCES objects(id),
 kind text NOT NULL CHECK(kind IN ('invoice','account','payment')),
 revision integer NOT NULL, data jsonb NOT NULL,
 action_id text NOT NULL REFERENCES actions(id), PRIMARY KEY(tenant,id)
);
CREATE UNIQUE INDEX enterprise_invoice_number ON enterprise_invoice
 (tenant,(data->>'supplierId'),(data->>'normalizedNumber')) WHERE kind='invoice';

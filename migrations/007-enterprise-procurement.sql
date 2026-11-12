-- Procurement supplements the existing object / approval / Action / Outbox path.
CREATE TABLE enterprise_procurement (
 tenant text NOT NULL, id text NOT NULL REFERENCES objects(id),
 kind text NOT NULL CHECK(kind IN ('purchase','supplier')),
 revision integer NOT NULL, data jsonb NOT NULL,
 action_id text NOT NULL REFERENCES actions(id), PRIMARY KEY(tenant,id)
);

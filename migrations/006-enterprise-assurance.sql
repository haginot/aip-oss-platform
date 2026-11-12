-- Finite B05 records use existing Action, object, transaction and audit contracts.
CREATE TABLE enterprise_assurance (
 tenant text NOT NULL, id text NOT NULL, kind text NOT NULL CHECK(kind IN ('resource','sla','policy','coverage')),
 scope jsonb NOT NULL, revision integer NOT NULL, data jsonb NOT NULL,
 action_id text NOT NULL REFERENCES actions(id), PRIMARY KEY(tenant,id)
);
CREATE TABLE enterprise_assurance_history (
 tenant text NOT NULL,id text NOT NULL,revision integer NOT NULL,action_id text NOT NULL REFERENCES actions(id),
 event jsonb NOT NULL,PRIMARY KEY(tenant,id,revision)
);
CREATE TRIGGER immutable_enterprise_assurance_history BEFORE UPDATE OR DELETE ON enterprise_assurance_history FOR EACH ROW EXECUTE FUNCTION audit_append_only();

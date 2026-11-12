-- Finite control records share the v2 Action / Audit transaction.
CREATE TABLE enterprise_controls (
 tenant text NOT NULL, id text NOT NULL, kind text NOT NULL CHECK(kind IN ('information','right','release','journey')),
 scope jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, data jsonb NOT NULL,
 action_id text NOT NULL REFERENCES actions(id), PRIMARY KEY(tenant,id)
);
CREATE TABLE enterprise_control_history (
 tenant text NOT NULL,id text NOT NULL,revision integer NOT NULL,action_id text NOT NULL REFERENCES actions(id),
 event jsonb NOT NULL,PRIMARY KEY(tenant,id,revision)
);
CREATE TRIGGER immutable_enterprise_control_history BEFORE UPDATE OR DELETE ON enterprise_control_history FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TABLE enterprise_release_roles (
 tenant text NOT NULL, principal text NOT NULL REFERENCES principals(id), role text NOT NULL CHECK(role IN ('legal','pr','ir')),
 PRIMARY KEY(tenant,principal,role)
);
CREATE TABLE enterprise_control_deliveries (
 tenant text NOT NULL, id text NOT NULL, channel text NOT NULL, operation_id text NOT NULL UNIQUE,
 action_id text NOT NULL REFERENCES actions(id), event jsonb NOT NULL, digest text NOT NULL,
 state text NOT NULL, receipt jsonb, PRIMARY KEY(tenant,id,channel)
);
CREATE TABLE enterprise_handoff_inbox (
 tenant text NOT NULL, event_id text NOT NULL, journey_id text NOT NULL, sequence integer NOT NULL,
 digest text NOT NULL, PRIMARY KEY(tenant,event_id),UNIQUE(tenant,journey_id,sequence)
);

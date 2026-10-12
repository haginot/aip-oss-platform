CREATE TABLE policy (id integer PRIMARY KEY CHECK(id=1), version text NOT NULL, epoch integer NOT NULL, available boolean NOT NULL);
CREATE TABLE principals (id text PRIMARY KEY, tenant text NOT NULL, stores jsonb NOT NULL, operations jsonb NOT NULL, secret_access boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true);
CREATE TABLE sessions (digest text PRIMARY KEY, principal text NOT NULL REFERENCES principals(id), expires timestamptz NOT NULL);
CREATE TABLE delegations (id text PRIMARY KEY, actor text NOT NULL REFERENCES principals(id), subject text NOT NULL REFERENCES principals(id), audience text NOT NULL, stores jsonb NOT NULL, operations jsonb NOT NULL, expires timestamptz NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE definitions (version text PRIMARY KEY, digest text NOT NULL UNIQUE, body jsonb NOT NULL, author text NOT NULL, reviewer text, state text NOT NULL CHECK(state IN ('DRAFT','REVIEWED','PUBLISHED')), simulation jsonb);
CREATE TABLE live_definition (id integer PRIMARY KEY CHECK(id=1), version text NOT NULL REFERENCES definitions(version));
CREATE TABLE objects (id text PRIMARY KEY, tenant text NOT NULL, store text NOT NULL, type text NOT NULL, revision integer NOT NULL CHECK(revision>0), fields jsonb NOT NULL, source_position text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE links (source text REFERENCES objects(id), target text REFERENCES objects(id), type text NOT NULL, PRIMARY KEY(source,target,type));
CREATE TABLE actions (id text PRIMARY KEY, tenant text NOT NULL, subject text NOT NULL, actor text NOT NULL, store text NOT NULL, key text NOT NULL, digest text NOT NULL, state text NOT NULL, revision integer NOT NULL, request jsonb NOT NULL, result jsonb NOT NULL, operation_id text NOT NULL UNIQUE, UNIQUE(tenant,subject,key));
CREATE TABLE outbox (operation_id text PRIMARY KEY REFERENCES actions(operation_id), action_id text NOT NULL REFERENCES actions(id), aggregate_id text NOT NULL REFERENCES objects(id), sequence integer NOT NULL, event jsonb NOT NULL, digest text NOT NULL, state text NOT NULL DEFAULT 'PENDING', attempt integer NOT NULL DEFAULT 0, lease_until timestamptz, lease_owner text, UNIQUE(aggregate_id,sequence));
CREATE TABLE audit (sequence bigserial PRIMARY KEY, previous_hash text NOT NULL, hash text NOT NULL, record jsonb NOT NULL);
CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit is append only'; END $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TABLE history (object_id text NOT NULL, revision integer NOT NULL, fields jsonb NOT NULL, action_id text NOT NULL REFERENCES actions(id), PRIMARY KEY(object_id,revision));
CREATE TABLE inbox (operation_id text PRIMARY KEY, digest text NOT NULL);
CREATE TABLE projection (aggregate_id text PRIMARY KEY, sequence integer NOT NULL, fields jsonb NOT NULL);
CREATE TABLE snapshots (id text PRIMARY KEY, subject text NOT NULL, query_digest text NOT NULL, policy_epoch integer NOT NULL, ontology_version text NOT NULL, items jsonb NOT NULL, expires timestamptz NOT NULL);
ALTER TABLE objects ADD COLUMN deleted boolean NOT NULL DEFAULT false;
ALTER TABLE objects ADD COLUMN source_owner text;
ALTER TABLE history ALTER COLUMN action_id DROP NOT NULL;
ALTER TABLE history ADD COLUMN source_position text;
ALTER TABLE history ADD COLUMN valid_at timestamptz;
ALTER TABLE history ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE history ADD COLUMN deleted boolean NOT NULL DEFAULT false;
CREATE TABLE source_checkpoints (tenant text NOT NULL, store text NOT NULL, source text NOT NULL, position bigint NOT NULL, PRIMARY KEY(tenant,store,source));
CREATE TABLE source_receipts (tenant text NOT NULL, store text NOT NULL, source text NOT NULL, position bigint NOT NULL, input_digest text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(tenant,store,source,position));
CREATE TRIGGER immutable_source_receipts BEFORE UPDATE OR DELETE ON source_receipts FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON history FOR EACH ROW EXECUTE FUNCTION audit_append_only();
ALTER TABLE outbox ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE definitions ADD COLUMN cases jsonb NOT NULL DEFAULT '[]';
ALTER TABLE definitions ADD COLUMN cases_revision integer NOT NULL DEFAULT 0 CHECK(cases_revision>=0);

CREATE TABLE pipeline_jobs (tenant text NOT NULL, id text NOT NULL, store text NOT NULL, actor text NOT NULL, subject text NOT NULL, delegation_id text, input_digest text NOT NULL, plan jsonb NOT NULL, state text NOT NULL CHECK(state IN ('READY','RUNNING','SUCCEEDED','CANCELLED')), cursor integer NOT NULL, PRIMARY KEY(tenant,id));

CREATE TABLE evidence_blobs (tenant text NOT NULL, store text NOT NULL, object_id text NOT NULL REFERENCES objects(id), hash text NOT NULL, content bytea NOT NULL, PRIMARY KEY(tenant,object_id,hash));
CREATE TRIGGER immutable_evidence_blobs BEFORE UPDATE OR DELETE ON evidence_blobs FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TABLE telemetry (sequence bigserial PRIMARY KEY, tenant text, stores jsonb NOT NULL, record jsonb NOT NULL);

CREATE TABLE identity_maps (tenant text NOT NULL, store text NOT NULL, source text NOT NULL, version text NOT NULL, entries jsonb NOT NULL, digest text NOT NULL, author text NOT NULL, reviewer text, state text NOT NULL, PRIMARY KEY(tenant,store,source,version));

CREATE TABLE schedules (tenant text NOT NULL, id text NOT NULL, store text NOT NULL, actor text NOT NULL, subject text NOT NULL, delegation_id text, digest text NOT NULL, plan jsonb NOT NULL, next_at bigint NOT NULL, PRIMARY KEY(tenant,id));
CREATE TABLE schedule_fires (tenant text NOT NULL, schedule_id text NOT NULL, fire_id text NOT NULL PRIMARY KEY, slot bigint NOT NULL, missed bigint NOT NULL, state text NOT NULL CHECK(state IN ('PENDING','DONE')), result jsonb, UNIQUE(tenant,schedule_id,slot), FOREIGN KEY(tenant,schedule_id) REFERENCES schedules(tenant,id));

CREATE TABLE continuity (tenant text NOT NULL, store text NOT NULL, mode text NOT NULL CHECK(mode IN ('NORMAL','DEGRADED','RECOVERING')), revision integer NOT NULL, PRIMARY KEY(tenant,store));
CREATE TABLE recovery_observations (tenant text NOT NULL, store text NOT NULL, operation_id text NOT NULL, record jsonb NOT NULL, PRIMARY KEY(tenant,store,operation_id));

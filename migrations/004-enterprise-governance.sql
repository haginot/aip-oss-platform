CREATE TABLE enterprise_documents (
 tenant text NOT NULL, object_id text NOT NULL REFERENCES objects(id), id text NOT NULL, version integer NOT NULL CHECK(version>0),
 name text NOT NULL, mime text NOT NULL, classification text NOT NULL, hash text NOT NULL, content bytea,
 state text NOT NULL CHECK(state IN ('CLEAN','QUARANTINED','DELETED')), retain_until timestamptz NOT NULL,
 legal_hold boolean NOT NULL DEFAULT false, provenance jsonb NOT NULL, PRIMARY KEY(tenant,id,version)
);
CREATE TABLE enterprise_erasure (
 tenant text NOT NULL, id text NOT NULL, version integer NOT NULL, erased_at timestamptz NOT NULL,
 PRIMARY KEY(tenant,id,version)
);
CREATE TABLE enterprise_connections (
 tenant text NOT NULL,id text NOT NULL,provider text NOT NULL,secret_ref text NOT NULL,
 scope jsonb NOT NULL,destination text NOT NULL,active boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant,id)
);
CREATE TABLE enterprise_routes (
 object_id text PRIMARY KEY REFERENCES enterprise_instances(id),connection_id text NOT NULL, revision integer NOT NULL,
 binding text NOT NULL
);
CREATE TABLE enterprise_webhooks (
 tenant text NOT NULL,connection_id text NOT NULL,event_id text NOT NULL, sequence integer NOT NULL,
 digest text NOT NULL,disposition text NOT NULL,PRIMARY KEY(tenant,connection_id,event_id)
);

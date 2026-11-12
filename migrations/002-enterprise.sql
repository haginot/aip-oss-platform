-- Additive v2 scope. A NULL Store never grants access to v1 clients.
ALTER TABLE objects ALTER COLUMN store DROP NOT NULL;
ALTER TABLE objects ADD COLUMN IF NOT EXISTS enterprise_scope jsonb;
ALTER TABLE objects ADD CONSTRAINT object_scope_exclusive CHECK
 ((store IS NOT NULL AND enterprise_scope IS NULL) OR
  (store IS NULL AND enterprise_scope IS NOT NULL AND jsonb_typeof(enterprise_scope)='object' AND
   enterprise_scope ?& ARRAY['legalEntityId','departmentId','caseId','classification']));
ALTER TABLE actions ALTER COLUMN store DROP NOT NULL;
CREATE TABLE enterprise_grants (
 principal text PRIMARY KEY REFERENCES principals(id), revision integer NOT NULL DEFAULT 1,
 scopes jsonb NOT NULL, operations jsonb NOT NULL, fields jsonb NOT NULL,
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE enterprise_delegations (
 id text PRIMARY KEY, actor text NOT NULL REFERENCES principals(id), subject text NOT NULL REFERENCES principals(id),
 scopes jsonb NOT NULL, operations jsonb NOT NULL, expires timestamptz NOT NULL, active boolean NOT NULL DEFAULT true,
 CHECK(actor<>subject)
);
CREATE TABLE enterprise_packages (
 id text NOT NULL, version text NOT NULL, tenant text NOT NULL, digest text NOT NULL,
 manifest jsonb NOT NULL, author text NOT NULL, reviewer text, state text NOT NULL,
 PRIMARY KEY(tenant,id,version)
);
CREATE TABLE enterprise_live (tenant text NOT NULL, id text NOT NULL, version text NOT NULL,
 PRIMARY KEY(tenant,id), FOREIGN KEY(tenant,id,version) REFERENCES enterprise_packages(tenant,id,version));
CREATE TABLE enterprise_instances (
 id text PRIMARY KEY REFERENCES objects(id), action_id text NOT NULL REFERENCES actions(id),
 package_id text NOT NULL, package_version text NOT NULL, binding text NOT NULL,
 authority jsonb NOT NULL, votes jsonb NOT NULL DEFAULT '[]', stage integer NOT NULL DEFAULT 0,
 state text NOT NULL, due timestamptz NOT NULL, timer_fired boolean NOT NULL DEFAULT false
);
CREATE TABLE enterprise_oidc_states (
 digest text PRIMARY KEY, nonce text NOT NULL, verifier text NOT NULL, expires timestamptz NOT NULL
);
CREATE TABLE enterprise_oidc_subjects (
 issuer text NOT NULL, subject text NOT NULL, principal text NOT NULL REFERENCES principals(id), PRIMARY KEY(issuer,subject)
);
CREATE TABLE enterprise_browser_sessions (
 digest text PRIMARY KEY REFERENCES sessions(digest), csrf text NOT NULL
);
CREATE TABLE enterprise_attachments (
 object_id text NOT NULL REFERENCES objects(id), hash text NOT NULL, content bytea NOT NULL,
 PRIMARY KEY(object_id,hash)
);
CREATE TRIGGER immutable_enterprise_attachments BEFORE UPDATE OR DELETE ON enterprise_attachments FOR EACH ROW EXECUTE FUNCTION audit_append_only();

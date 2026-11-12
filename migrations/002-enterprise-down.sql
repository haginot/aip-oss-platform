-- Rollback is allowed only before enterprise data is written. Never discard business data.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM objects WHERE store IS NULL) OR EXISTS(SELECT 1 FROM actions WHERE store IS NULL)
 THEN RAISE EXCEPTION 'enterprise data must be archived before rollback'; END IF;
END $$;
DROP TABLE IF EXISTS enterprise_assurance_history, enterprise_assurance;
DROP TABLE IF EXISTS enterprise_control_deliveries, enterprise_control_history, enterprise_handoff_inbox, enterprise_release_roles, enterprise_controls;
DROP TABLE IF EXISTS enterprise_routes, enterprise_webhooks, enterprise_connections, enterprise_documents, enterprise_erasure;
DROP TABLE enterprise_attachments, enterprise_browser_sessions, enterprise_oidc_subjects, enterprise_oidc_states,
 enterprise_instances, enterprise_live, enterprise_packages, enterprise_delegations, enterprise_grants;
ALTER TABLE objects DROP CONSTRAINT object_scope_exclusive;
ALTER TABLE objects DROP COLUMN enterprise_scope;
ALTER TABLE objects ALTER COLUMN store SET NOT NULL;
ALTER TABLE actions ALTER COLUMN store SET NOT NULL;

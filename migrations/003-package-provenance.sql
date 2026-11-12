-- Preserve historical packages without inventing their delegated identity.
-- Legacy rows have NULL provenance and cannot receive a new review/publication.
ALTER TABLE enterprise_packages ADD COLUMN author_identity jsonb;
ALTER TABLE enterprise_packages ADD COLUMN reviewer_identity jsonb;

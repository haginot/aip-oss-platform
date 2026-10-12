-- Additive, disposable read index. Business state and deduplication remain authoritative.
CREATE TABLE search_projection (id text PRIMARY KEY, payload jsonb NOT NULL);
GRANT SELECT ON search_projection TO foundation_app;
CREATE TABLE search_projection_checkpoint (id integer PRIMARY KEY CHECK(id=1), position jsonb NOT NULL);
GRANT SELECT ON search_projection_checkpoint TO foundation_app;

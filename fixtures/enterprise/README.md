# Enterprise regression fixtures

These files were recovered from the ENT-201/ENT-202 development history and the
preparation workflow bundle so a checkout can run the regression suite without
machine-local logs. `provenance.json` records recovered and current file hashes.
The original archives and protected release evidence remain separate. These
fixtures are test inputs, never proof of a historical execution or an approval.

Normal tests start disposable PostgreSQL and Chromium instances. The R1E–R1J
supports use the real seeded gateway, OIDC, grants and business tables. Set the
corresponding `R1*_EXTERNAL_POSTGRES=1` only to use the historical external
PostgreSQL adapter, which retains its exact identity checks. Providing an
`R1*_BROWSER_MANIFEST` selects the existing attested browser path; a malformed or
stale supplied manifest still fails rather than falling back locally. Local
runs do not attest a production host, runner or formal acceptance.

R1C/E/F/G/H explicitly deny the command while retaining read permission, hold
that real denial response, revoke read permission, and inject a transport failure
in the follow-up read. They require all retained state to be erased. R1I/J hold
the request before sending it and verify the denial audit records. The old
optional expectation of retained forbidden state is no longer accepted.

F/G use the seeded current-schema setup from J; their archived setup referred
to obsolete tables. The R1F external adapter also had an unmatched closing brace.
The preparation fixtures preserve the original scope and compiled bundle bytes;
the test still checks their hashes and rejects mutated history and approvals.

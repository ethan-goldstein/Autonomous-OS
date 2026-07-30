# Security

## What is not in this repository

Source only. Excluded by `.gitignore` and never committed:

- **Credentials.** Every secret is read from an environment variable. There are
  no hardcoded keys, tokens, passwords, IP addresses, or hostnames in this
  codebase. `.env.example` documents each variable with a placeholder.
- **The database.** Created at runtime under `server/data/`.
- **Private agents.** The agents in `server/agents/` are illustrative examples.
  Real workflows are not published.

## Design invariants

1. **One chokepoint to the model.** Every call passes through
   `server/lib/guardrails.js`. Fetched content is data, never instructions.
2. **One egress path.** No agent acts outward directly. Everything routes
   through `server/lib/approvals.js`. A `risky` lane always requires a human
   decision, and `laneAutoOn()` rejects it before reading any setting, so no
   configuration flag can subvert the rule.
3. **Auth is mounted before routes are declared.** A new endpoint cannot ship
   unauthenticated by omission.
4. **No localhost bypass.** TLS terminates on the same host and proxies to
   loopback, so exempting `127.0.0.1` would disable authentication across the
   whole private network. This is deliberate and must not be "fixed."

## Reporting

Open an issue. Do not include credentials or personal data.

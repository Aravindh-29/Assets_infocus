# Verification record

Verified on 21 September 2026 on this Windows machine with Node.js24.18.0, npm11.16.0, PostgreSQL17, and Microsoft Edge through Playwright.

## Results

| Check                                  | Result                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| Prisma schema validation and migration | Passed; initial migration applied; no pending migrations |
| Backend and frontend TypeScript        | Passed                                                   |
| Backend production compilation         | Passed                                                   |
| Frontend Vite production build         | Passed, with route-based chunks                          |
| Backend unit tests                     | 47 passed                                                |
| Frontend unit tests                    | 13 passed                                                |
| Real PostgreSQL API integration tests  | 37 passed                                                |
| Browser acceptance tests               | 19 passed                                                |
| npm dependency audit                   | 0 known vulnerabilities reported at verification time    |
| Local API readiness                    | HTTP200; PostgreSQL connected                            |
| Desktop/mobile visual review           | Completed; no horizontal viewport overflow at390px       |

**116 automated tests passed.** Tests run against application logic and a real, separately migrated PostgreSQL test database. The browser suite starts its own API/frontend on ports5001/5174. It does not modify the development application's sample inventory.

The UI modernization also preserves all backend/schema source files (verified by SHA-256 comparison). See [UI modernization](UI-MODERNIZATION.md) for its plan, implementation and verification scope. Dependency versions were unchanged during the UI work; the dependency-audit row records the initial verification result.

## Browser coverage

1. An administrator creates two employees and a laptop, assigns it, transfers custody, returns it, verifies the current holder/timeline, starts offboarding, accounts for the outstanding asset, completes offboarding, and downloads CSV.
2. Nineteen administrative/profile screens load API data without browser application errors or unexpected routing.
3. A newly provisioned user completes the required password change, reaches the dashboard, and retains their session after a full page reload.
4. An employee sees their own inventory/profile and cannot navigate into user administration or register assets.
5. Desktop and390px mobile dashboards/assets render without viewport overflow. Screenshots are generated under `.local/` for visual review.
6. Sidebar state persists; command search, profile menu, modal focus, mobile drawer and logout support keyboard interaction.
7. Asset/employee quick views preserve list context, expose real records and restore focus when dismissed.
8. Advanced filters, chips and table/card modes reflect API data. CSV import saves actual records, and bulk movement reports a concurrently changed record while preserving successful changes.
9. Dashboard metrics/drilldowns match API results. Report counts, filters and downloaded CSV contents are verified against real fixtures; notification read/unread controls update the inbox.
10. Employee directory filters/counts match custody data; offboarding progress prevents completion until the outstanding asset is accounted for.
11. Forms disable duplicate submission and dismissal while a request is pending.

API regression tests additionally cover token rotation/replay, access restrictions, duplicate tags/serials, concurrent assignments, invalid transitions, damaged returns and repairs, movements, administrator-approved offboarding loss, incident approval, historical reports, all three export formats, soft deletion/restoration, immutable history, password/reset-link invalidation, and audit context.

## Repeat locally

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:e2e
npm.cmd run build
npm.cmd audit
```

Integration/browser tests require `backend/.env.test` pointing to a separate database whose name ends in `_test`; create/migrate/seed it with `npm run db:test:setup`. Test records deliberately retain their append-only history and use unique identifiers on each run.

The browser suite defaults to Microsoft Edge, already installed on this computer. To use Google Chrome, set `PLAYWRIGHT_CHANNEL=chrome`. On a machine without either browser, install a supported browser or adapt the Playwright channel and install Playwright Chromium. Browser traces and an HTML report are written to `test-results/` and `playwright-report/` when the tests run.

## Verification boundaries

Dockerfiles and Compose configuration are included, but Docker is not installed on this machine, so the container stack was not executed here. Local execution uses the installed PostgreSQL17 service directly.

External SMTP delivery, HTTPS termination, cloud deployment, backup scheduling, and enterprise integrations require target-environment configuration. Password recovery is exercised locally through development reset links. No production deployment, external integration, penetration test, or sustained load test was performed.

## Database setup and Nginx installer verification

Verified on 21 September 2026 for the new setup/deployment scripts:

| Check                                                                           | Result                                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Bash syntax for `scripts/setup-db.sh` and `scripts/install.sh`                  | Passed; scripts use LF line endings                         |
| Installer help, dry run, and invalid-option checks                              | Passed; no system deployment performed                      |
| Database helper JavaScript syntax, help, and dry run                            | Passed                                                      |
| Real PostgreSQL setup-helper scenarios                                          | 10 passed; Node reports 11 including the parent test        |
| Generated Nginx configuration syntax and HTTPS                                  | Passed using isolated loopback ports under Ubuntu 22.04 WSL |
| Nginx API path/query preservation and forwarded HTTPS header                    | Passed against a temporary local API fixture                |
| SPA `/login` and `/assets/:id` routes                                           | Passed                                                      |
| Static files, missing-file 404, hidden-file rejection, ACME path, HTTP redirect | Passed                                                      |
| Existing local frontend and database-backed API health after verification       | HTTP 200; PostgreSQL connected                              |

The database test creates uniquely named disposable databases and roles on the installed PostgreSQL 17 server. It verifies creation and migration, no automatic demo users, preservation of rows/migration history on rerun, owner/runtime password preservation, rejection of excessive runtime privileges/ownership, unknown migration history, a disabled history trigger, unrelated populated databases, wrong ownership, and reserved database names. Cleanup completed. The application's development and integration-test databases were not changed by this verification.

Repeat the database checks using the protected configuration described in [database helper tests](DATABASE.md#testing-the-setup-helper). Repeat the Nginx checks on Linux with Python 3, Bash, OpenSSL, curl, and Nginx installed:

```bash
python3 scripts/tests/nginx-routing.test.py
```

The Nginx test extracts the installer's actual server-block template, uses a temporary certificate and files, launches its own Nginx process on temporary loopback ports, and removes the fixtures afterward. It does not edit `/etc/nginx` or restart the system Nginx service.

These checks do not constitute a full server installation. Systemd provisioning, Let's Encrypt issuance/renewal for INFOCUS, and the complete installer upgrade/rollback flow still need verification during deployment. Existing application-suite results above were not rerun for these documentation and setup-script changes.

## Shared-server verification

On 21 September 2026, performed an authorized read-only SSH inspection of the intended INFOCUS server and ran the hardened installer's `--check` mode for `assets.infocuscs.com`, API port 5002, and PostgreSQL port 5432. No installation was performed.

| Check                             | Result                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Existing SERV-IT site             | HTTP 200, valid TLS; existing API uses 5000                                                                                              |
| Existing Grow Together site       | HTTP 200, valid TLS; existing API uses 5001                                                                                              |
| New hostname                      | DNS resolves to the inspected server                                                                                                     |
| Host                              | Ubuntu 26.04; active Nginx 1.28; existing PostgreSQL 18 on 5432                                                                          |
| INFOCUS preflight                 | Passed; API port 5002 available; application paths/database/roles unused                                                                 |
| Shared Node                       | Existing Node 20 retained; installer plans a separate private Node 22                                                                    |
| Build resources                   | About 2.6 GiB memory available and 20 GiB free disk at inspection                                                                        |
| Existing-host conflict refusal    | Preflight rejected SERV-IT's hostname without modifying it                                                                               |
| Before/after comparison           | Same service PIDs/start times, Nginx configuration hashes, database names/owners and INFOCUS namespace                                   |
| Shared Certbot renewal            | Existing timer active/enabled; unchanged                                                                                                 |
| Isolated two-app Nginx regression | Passed; existing HTTP/HTTPS apps and IPv4/IPv6 implicit defaults retained after adding INFOCUS and gracefully reloading; same master PID |

The updated installer requires installed system prerequisites, avoids OS package changes/shared-service startup or boot enablement, appends its enabled site after existing sites, and bounds build resources. The isolated Nginx fixture mirrors the existing host's IPv4/IPv6 routing arrangement. Actual deployment will still create INFOCUS resources and gracefully reload Nginx; runtime capacity, certificate issuance, and application workflows must be checked after deployment. Rerun `--check` immediately before installing because server state can change.

## Interactive installer verification

The repository-root `install.sh` forwards to `scripts/install.sh`. Running it without arguments opens four sequential terminal prompts for the domain, API port, PostgreSQL port, and trusted HTTPS. No certificate email is requested or required. Existing managed hostname/port settings are retained. Command-line flags remain available.

All 12 terminal-input tests passed in local Ubuntu WSL. They cover the complete four-answer flow without email, default/custom answers, invalid-input retries, optional explicit-email compatibility, Certbot's no-email argument selection, EOF cancellation, flag precedence, non-terminal refusal, launching from another directory, the exact no-argument path, and retained configuration without exposing stored credentials. Tests used dry-run mode or cancelled before execution; they did not deploy an application.

Repeat on Linux:

```bash
python3 scripts/tests/install-input.test.py
```

Two tests require root to exercise the real no-argument sudo path and root-owned configuration; use `sudo python3 scripts/tests/install-input.test.py` to include them. Their fixtures are temporary files, and they do not contact PostgreSQL, reload Nginx, or start application services.

## HTTPS recovery and ACME regression

The first server installation completed its database migrations and started the INFOCUS API, but certificate issuance failed with HTTP 403. Nginx's error log identified permission denied on the public ACME challenge path: the installer used `umask 027`, and its implicitly created `acme` and `.well-known` parent directories were mode 0750. The unprivileged Nginx worker could not traverse them.

The installer now explicitly creates all three public challenge directories with mode 0755 and verifies a mode-0644 probe through Nginx before requesting a certificate. It removes its probe afterward and allows for worker startup during a graceful reload. Configuration files and private keys retain their protected permissions.

The isolated Nginx regression runs with a `www-data` worker when executed as root. It reproduces HTTP 403 with mode-0750 ancestors, invokes the installer's actual permission helper, verifies HTTP 200 on repeated runs, and checks probe cleanup. The two existing virtual hosts and their IPv4/IPv6 defaults continue to pass.

Targeted recovery on the INFOCUS server succeeded on 21 September 2026: public challenge verification returned HTTP 200, certificate issuance without a required email succeeded, and `https://assets.infocuscs.com/login` and `/api/health` passed with trusted TLS and a connected database. The certificate expires on 19 December 2026. The existing Certbot timer is active, its stored authenticator is webroot, and the INFOCUS renewal hook is installed. Renewal was configured but a forced renewal was not performed.

Both existing applications also returned HTTP 200 with valid TLS after recovery. Their Nginx configuration hashes and application process IDs/start times were unchanged; the INFOCUS API and PostgreSQL processes were also unchanged. Only the INFOCUS challenge-directory permissions, its certificate paths, and its renewal hook were repaired, followed by a graceful Nginx reload. No database reset, application rebuild, or application-service restart was required.

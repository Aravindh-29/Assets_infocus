# UI modernization plan

## Existing application audit

The application uses React, TypeScript, Vite, React Router, Lucide, Recharts, React Hook Form and Zod. `AppLayout` owns navigation, search and the authenticated shell. `components/ui.tsx` provides tables, dialogs, status badges, states and timelines. `AssetForms` and `RecordForm` submit validated forms to the existing API. `AuthContext`, the Axios refresh interceptor and `useResource` own authentication and data fetching.

Existing routes include dashboard, assets and asset detail, employees and profiles, assignments, transfers, returns, repairs/maintenance, employee requests, offboarding and detail, movements, reports, notifications, organization reference data, users, audit, settings and authentication. They will remain available with the same role protections.

Existing business operations include register/edit/archive/restore, assign/transfer/return/move, status transitions, repair and maintenance, requests and approvals, employee offboarding and report exports. PostgreSQL, backend contracts and validation remain unchanged.

## Implementation plan (recorded before implementation)

1. Establish centralized console tokens: restrained teal/navy identity, compact typography and spacing, consistent vector icons, borders, status treatments and accessible focus states.
2. Modernize the shared shell: persisted desktop collapse, mobile drawer, breadcrumbs, keyboard search, notification center, profile menu and practical help.
3. Enhance reusable UI: accessible slide-over dialogs, icon status badges, purposeful loading/empty/error states, keyboard menus, tooltips, timeline icons and dense tables.
4. Rebuild the dashboard with six real KPI links, actionable charts, activity and role-aware quick actions. Reorganize real reports into a discoverable report library.
5. Upgrade assets: responsive cards/table, advanced filters and removable chips, valid contextual operations, real CSV import, bulk actions against existing endpoints, richer detail sections and guided custody forms.
6. Upgrade employee profiles, operational lists, repair/request pages and offboarding with useful counts, clear progress, current custody and accessible actions.
7. Verify build and automated tests; exercise login, dashboard, search, asset creation and lifecycle, employee workflows, reports, logout and mobile layouts. Inspect all major pages and resolve visual or behavioral regressions.

## Design and scope decisions

- Preserve the Asset Management identity; use enterprise ITSM density and navigation patterns without copying another product.
- Use live API data and computed proportions. Do not fabricate trend metrics, record counts or charts.
- Keep existing authorization and server validation authoritative. Bulk operations disclose partial failures and use existing per-record endpoints.
- Documents or other unsupported capabilities must not appear as fake controls.
- Use shared design tokens that can support a future dark theme. No new UI framework is necessary.

## Validation record

Completed on 21 September 2026.

- Persisted sidebar collapse, mobile navigation drawer, breadcrumbs, Ctrl+K search with keyboard results, help, profile menu and live notification preview.
- Six live dashboard KPIs, interactive status/category/department drilldowns, chart series controls, activity and role-aware quick actions.
- Asset table/cards, advanced draft filters and removable chips, column controls, contextual actions, quick view, real CSV import and reviewed bulk operations with individual outcomes.
- Asset record sections and keyboard tabs, current holder, complete lifecycle history, paginated maintenance retrieval and administrator audit view.
- Guided assignment and transfer confirmations, return accessory checklist, employee cards/profiles/quick views and true offboarding progress.
- Report library with exact record counts, effective filters and real CSV/Excel/PDF exports; grouped notification inbox with read/unread actions.
- Shared status icons, semantic tokens, skeletons, retry/empty states, accessible tooltips, focus traps and protection against dismissing a saving form. Earlier success messages are cleared when another dialog opens so they cannot obscure its fields.

### Verified checks

| Check | Result |
|---|---|
| Backend and frontend type checks | Passed |
| Production build | Passed; route chunks retained |
| Backend unit tests | 47 passed |
| Frontend unit tests | 13 passed, including CSV parsing and role-aware bulk eligibility |
| PostgreSQL integration checks | 37 passed |
| Browser tests | 19 passed |
| Backend/schema preservation | SHA-256 comparison found zero modified files in backend/src and backend/prisma |
| Local readiness | Frontend HTTP 200; API health confirms PostgreSQL connected |

The browser suite covers existing registration/assignment/transfer/return/offboarding flows, employee access restrictions, required password changes, every major route, search and menu keyboard interaction, saved navigation preferences, mobile layouts, preview drawers, filter chips, report exports, notifications, CSV import and a real concurrent-change scenario during bulk movement. Saving-state tests verify that Escape, Cancel and the close icon cannot dismiss an in-flight form.

Desktop/mobile screenshots and the workflow drawers were visually reviewed. Generated review files are under the ignored `.local/` directory. Tests use asset_management_test on ports 5001/5174, keeping the development inventory separate. Backend APIs, authentication and database schema were preserved. No additional runtime packages were required.

## Interactive login experience

The sign-in and password recovery pages now use a midnight and mint visual theme with a bright, focused form panel. The hero combines a projected asset constellation, luminous orbital trails, vector device cards, pointer lighting and animated typography. The illustration represents asset categories; it does not imply live inventory data before authentication.

Drag the orbit to rotate it, then release for inertia. Keyboard users can focus the scene and use arrow keys, Home or Reset view. Horizontal touch gestures rotate it and release pointer capture when finished. A visible mobile Sign in shortcut moves directly to the form.

Pause/play is saved locally. Reduced motion preferences disable automatic movement, and hidden browser tabs suspend the animation loop. Canvas resolution is capped at twice CSS pixel density, pointer updates avoid React renders, and animation frames, observers and listeners are cleaned up on unmount. Existing login, remembered sessions, password visibility, reset and required-password-change flows retain their API contracts. No new runtime dependencies were added.

Verified the frontend type check and production build. All five new login browser scenarios and five existing workflow regression scenarios passed (the touch test was rerun after correcting its cleanup). Coverage includes mouse and keyboard rotation, typing, persisted motion preference, reduced motion, real touch dragging/native scrolling, mobile shortcut focus, failed-login recovery, remembered sessions, password changes, role restrictions and asset custody workflows. Desktop, laptop and mobile screenshots were visually reviewed; no browser runtime errors or mobile horizontal overflow were found. The local frontend remains on port 5173 and the API health check confirms PostgreSQL is connected.

The login subsequently changed to fit the current viewport. The orbit takes remaining desktop space, and mobile screens use a compact illustration above the form. Browser measurements at 1440×900, 1280×720, 1000×650, 900×600, 768×800, 390×844, 375×667 and 320×568 confirmed no page or form scrolling, with the submit button visible. Exceptionally short screens and expanded error content retain an accessible form overflow fallback.

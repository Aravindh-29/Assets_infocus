# REST API

Local base URL: `http://127.0.0.1:5000/api`. Through the frontend, use relative `/api` URLs. All endpoints except health and authentication/recovery require an access token: `Authorization: Bearer <accessToken>`.

## Response format

Successful responses use `{ "success": true, "data": ..., "message": "optional message" }`. Lists return a data array and `meta: {page,pageSize,total,totalPages}`. Errors use `{ "success": false, "message": "User-safe explanation", "errorCode": "MACHINE_CODE" }`. Validation may add details. Codes include 400,401,403,404,409,422,429,500.

Dates use ISO strings; identifiers are UUIDs. Purchase/repair costs may serialize as decimal strings. Status, condition, and role identifiers use uppercase strings.

## Authentication

| Method | Path                  | Body / behavior                                                                             |
| ------ | --------------------- | ------------------------------------------------------------------------------------------- |
| POST   | /auth/login           | `{identifier,password,remember?}`; returns `{user,accessToken}` and HttpOnly refresh cookie |
| POST   | /auth/refresh         | Rotates refresh cookie; returns new user/token                                              |
| POST   | /auth/logout          | Revokes refresh session and clears cookie                                                   |
| GET    | /auth/me              | Current user with employee profile, no authentication secrets                               |
| POST   | /auth/forgot-password | `{email}`; development-only reset link when SMTP is absent                                  |
| POST   | /auth/reset-password  | `{token,password}`                                                                          |
| POST   | /auth/change-password | `{currentPassword,newPassword}`                                                             |

Browser clients must use credentials for cookies. Keep access tokens in memory. Refresh tokens are hashed in PostgreSQL and rotated on use; replay revokes sessions. Role and active-account checks run at the API, independently of the frontend navigation.

## Assets and lifecycle

| Method             | Path                 | Purpose                                                        |
| ------------------ | -------------------- | -------------------------------------------------------------- |
| GET / POST         | /assets              | List or register                                               |
| GET / PUT / DELETE | /assets/:id          | View, edit, or soft-delete                                     |
| POST               | /assets/:id/restore  | Admin restores a soft-deleted asset                            |
| GET                | /assets/:id/history  | Complete asset timeline                                        |
| POST               | /assets/:id/assign   | `{employeeId,assignedAt?,expectedReturnAt?,condition?,notes?}` |
| POST               | /assets/:id/transfer | `{employeeId,transferredAt?,reason,notes?}`                    |
| POST               | /assets/:id/return   | `{returnedAt?,condition,accessories?:string[],damage?,notes?}` |
| POST               | /assets/:id/move     | `{locationId,notes?}`                                          |
| PATCH              | /assets/:id/status   | `{status,notes?}`; only allowed transitions                    |

Registration requires `assetTag,assetType,categoryId,manufacturer,model`. Other fields include `serialNumber,condition,purchaseDate,purchaseCost,vendor,invoiceNumber,warrantyStart,warrantyExpiry,locationId,departmentId,description,notes,qrCode,barcode`. Status cannot bypass a lifecycle workflow through generic edits.

List query parameters include `search,page,pageSize,sortBy,sortOrder,status,categoryId,departmentId,locationId,condition,assigned,purchaseFrom,purchaseTo,warrantyFrom,warrantyTo`. Category serial uniqueness is validated along with the unique asset tag.

## Employees and reference data

| Method             | Path                                              | Purpose                                              |
| ------------------ | ------------------------------------------------- | ---------------------------------------------------- |
| GET / POST         | /employees                                        | List or create employees                             |
| GET / PUT / DELETE | /employees/:id                                    | View, edit, or deactivate/archive                    |
| GET                | /employees/:id/assets                             | Current assets                                       |
| GET                | /employees/:id/history                            | Employee asset history                               |
| GET                | /lookups                                          | Active reference data and permitted employee choices |
| GET / POST         | /categories, /departments, /locations             | List or create reference records                     |
| PUT                | /categories/:id, /departments/:id, /locations/:id | Edit; `{active:false}` disables                      |

Employee fields: `employeeId,name,email,designation?,departmentId?,locationId?,managerId?,status?,joinedAt?`. Employee roles can only access their own authorized data. Category fields include `name,description,serialRequiredUnique,active`; locations include `address`.

## Operations

| Method     | Path                                           | Body / behavior                                                       |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| GET        | /assignments, /transfers, /returns, /movements | Transaction lists with related assets/employees                       |
| GET / POST | /repairs                                       | `{assetId,issue,vendor?,cost?,notes?}`                                |
| PATCH      | /repairs/:id                                   | `{status,vendor?,cost?,notes?}`; OPEN → IN_REPAIR → REPAIRED → CLOSED |
| GET / POST | /maintenance                                   | `{assetId,description,scheduledAt?,status?,notes?}`                   |
| PATCH      | /maintenance/:id                               | Update maintenance progress                                           |
| GET / POST | /requests                                      | `{assetId,type,description,location?,targetEmployeeId?}`              |
| PATCH      | /requests/:id                                  | Manager review `{status:APPROVED\|REJECTED,resolution?}`              |
| GET / POST | /offboarding                                   | Start `{employeeId,notes?}` or list                                   |
| GET        | /offboarding/:id                               | Checklist with current resolutions                                    |
| POST       | /offboarding/:id/complete                      | Fails with outstanding equipment                                      |

Request types: DAMAGE,LOST,RETURN,TRANSFER. Employees submit only for their own equipment. Damage/loss approval applies the controlled incident transition. Approved return/transfer requests complete when staff perform the corresponding physical-handling workflow.

## Reports, dashboards, and administration

| Method     | Path                                 | Purpose                                                  |
| ---------- | ------------------------------------ | -------------------------------------------------------- |
| GET        | /dashboard/summary                   | Role-scoped KPIs, distributions, trends, recent activity |
| GET        | /search?q=...                        | Role-scoped asset/employee search                        |
| GET        | /reports/:type                       | `{columns:[{key,label}],rows:[]}`                        |
| GET        | /reports/:type?format=csv\|xlsx\|pdf | Download report; optional `ids` selects assets           |
| GET        | /notifications                       | Current user's notifications                             |
| PATCH      | /notifications/:id/read              | Mark one notification read                               |
| POST       | /notifications/read-all              | Mark all current-user notifications read                 |
| GET        | /audit-logs                          | Admin-only append-only audit records                     |
| GET / POST | /users                               | Admin lists/creates accounts                             |
| PUT        | /users/:id                           | Admin changes identity, role, activity or employee link  |
| POST       | /users/:id/reset-password            | Admin sets temporary `{password}`                        |
| GET / PUT  | /settings                            | Admin settings                                           |
| GET        | /health                              | API/database readiness                                   |

Report types: `inventory,assigned,available,employee-assets,movements,lost,damaged,repairs,warranty,offboarding`. CSV spreadsheet cells are escaped against formula injection. Export endpoints also create audit records.

## Example acceptance sequence

1. Login and store the access token.
2. GET /lookups to obtain category, location, and department IDs.
3. POST /employees to create John and David.
4. POST /assets to register LAP-0001.
5. POST /assets/:id/assign with John's UUID.
6. POST /assets/:id/transfer with David's UUID and a reason.
7. POST /assets/:id/return with condition GOOD and returned accessories.
8. GET /assets/:id/history to verify preserved events; GET /reports/inventory?format=xlsx to export.

Requests are validated server-side. Unavailable assets, duplicate active assignments, invalid chronology, duplicate tags/serials, invalid status transitions, and incomplete offboarding are rejected. Assignment/transfer/return state, history, audit, and related notifications are committed atomically.

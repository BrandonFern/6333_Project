# SmartLab — Change Summary

## New Files Added

| File | What it is |
|---|---|
| `schema.sql` | MySQL DDL — run once to create all 7 tables (`Buildings`, `Departments`, `Equipment_Types`, `Users`, `Equipment`, `Reservations`, `Maintenance_Logs`, `Training_Certifications`) with foreign keys, enums, and constraints |
| `seed.py` | Python script that populates the DB with demo data: 3 buildings, 5 departments, 7 equipment types, 11 equipment items, 6 user accounts, certifications, and 8 sample reservations. Run with `python seed.py` |
| `.env.example` | Template for the 6 required environment variables (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, `SECRET_KEY`). Copy to `.env` and fill in your values |
| `README.md` | Full setup guide, demo account credentials, role capability table, and complete API endpoint reference |

---

## `api.py` — Bug Fixes

| Location | Bug | Fix |
|---|---|---|
| `get_db()` line ~33 | `SET time_zone = 'US/Central'` crashes on any MySQL without timezone tables loaded (common on AWS RDS) | Wrapped in `try/except` — silently skips if it fails |
| `admin_required` decorator | DB cursor and connection were not closed before `abort(403)`, leaking connections on every denied request | Moved `cur.close()` / `db.close()` into a `finally` block |
| `api_create_reservation` | Training certification was always required regardless of whether the equipment type needs it — blocked reservations for all equipment | Now reads `requires_training` from `Equipment_Types` first; only enforces cert check when it's `TRUE` |
| `api_utilization` analytics | `WHERE r.status = 'active'` only counted in-progress reservations — historical date range reports returned no data | Changed to `r.status IN ('active', 'completed')` |
| `api_get_equipment` | `equipment_type_id` and `building_id` were not returned in the response | Added both fields to the `SELECT` |
| `api_users` | `department_id` was not returned in the response | Added `u.department_id` to the `SELECT` |
| `api_get_certifications` | Only ever returned the logged-in user's certs, even for admins. Also didn't return `certification_id` or `user_name` | Rewrote to be role-aware: admin gets all users' certs; everyone else gets their own. Now always returns `certification_id` and `user_name` |
| `api_grant_certification` | Granting a cert for a user+type combination that already existed would throw a DB error | Added `ON DUPLICATE KEY UPDATE` so re-granting renews the expiration date instead of failing |

---

## `api.py` — New Endpoints (Phase 3)

| Method | Endpoint | Who | What it does |
|---|---|---|---|
| `PATCH` | `/api/equipment/<id>` | Admin | Edit equipment name, type, and building |
| `DELETE` | `/api/equipment/<id>` | Admin | Retire equipment (soft-delete to `retired` status), cancels pending/approved reservations |
| `PATCH` | `/api/users/<id>` | Admin | Change a user's role and/or department |
| `DELETE` | `/api/users/<id>` | Admin | Hard-delete a user account (blocked with a clear error message if the user has reservations or maintenance logs) |
| `DELETE` | `/api/certifications/<id>` | Admin | Delete a specific certification record |

---

## `index.html` — New Modals

| Modal ID | Purpose |
|---|---|
| `editEquipModal` | Pre-filled form for editing equipment name, type, and building (admin only) |
| `editUserModal` | Pre-filled form for editing a user's role and department (admin only) |

---

## `app.js` — New & Updated Behavior

### Updated functions

| Function | Change |
|---|---|
| `loadSetupDropdowns()` | Now also populates the two new edit modal dropdowns (`editEquipType`, `editEquipBuilding`, `editUserDept`) |
| `loadEquipment()` | Caches rows into `_equipCache` for modal pre-fill. Reserve button now pre-selects the equipment in the modal. Admin users see Edit and Retire buttons per row |
| `loadUsers()` | Caches rows into `_userCache` for modal pre-fill. Admin users see Edit and Delete buttons per row |
| `loadCertifications()` | Admin sees all users' certs with a User column and Delete button. Table header updates dynamically based on role |
| `submitGrantCert` handler | Now calls `loadCertifications()` after granting so the table refreshes |

### New functions

| Function | What it does |
|---|---|
| `reserveEquipment(id)` | Opens the reservation modal and pre-selects the chosen equipment |
| `openEditEquipModal(id)` | Looks up the equipment row from cache and pre-fills the Edit Equipment modal |
| `openEditUserModal(id)` | Looks up the user row from cache and pre-fills the Edit User modal |
| `retireEquipment(id)` | Confirms with user, calls `DELETE /api/equipment/<id>`, refreshes equipment list and dashboard |
| `deleteUser(id)` | Confirms with user, calls `DELETE /api/users/<id>`, refreshes user list |
| `deleteCert(id)` | Confirms with user, calls `DELETE /api/certifications/<id>`, refreshes cert list |
| `submitEditEquip` handler | Reads the edit equipment modal fields and calls `PATCH /api/equipment/<id>` |
| `submitEditUser` handler | Reads the edit user modal fields and calls `PATCH /api/users/<id>` |

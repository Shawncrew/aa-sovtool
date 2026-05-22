# aa-sovtool

Alliance Auth app for EVE Online **Equinox sovereignty planning**, **corp
structure visibility**, and **access-list management** — a rebuild of the
standalone [`sovtool`](../sovtool) project as a first-class Alliance Auth
plugin.

## Highlights

- **Sovereignty Planner** — same React/React-Flow interactive system graph
  as the original tool. Card positions, role colouring, transfer routing,
  Ansiblex linking, history log, and import/export of layout snapshots are
  preserved one-for-one.
- **Alliance Auth permissions** — `view_sovtool` / `edit_sovtool` /
  `manage_sovtool` are exposed as Django permissions, plus a
  per-user-per-region edit grant table for fine-grained region scoping.
  Three default groups (`Sovtool Viewers`, `Sovtool Editors`,
  `Sovtool Admins`) are auto-created.
- **ESI integration** — uses `django-esi` to register a *corp token* for
  the corporation(s) that own your sovereignty structures and pulls live
  data from the new Equinox endpoints documented in
  [the CCP blog](https://developers.eveonline.com/blog/equinox-on-esi-structures-sovereignty-and-access-lists):
  - `GET /sovereignty/structures/`
  - `GET /sovereignty/systems/` *(activity-defense multiplier breakdowns)*
  - `GET /sovereignty/campaigns/`, `/sovereignty/map/`
  - `GET /corporations/{corp_id}/structures/`
  - structure → access-list members
  - raidable-skyhook rolling feed
- **Celery tasks** for periodic refresh (`refresh_sovereignty_structures`,
  `refresh_corp_structures`, `refresh_access_lists`).

## Installation

1. Install the package into your Alliance Auth virtualenv:

    ```bash
    pip install -e /path/to/aa-sovtool
    ```

2. Add `aasovtool` to `INSTALLED_APPS` (after `allianceauth` and `esi`)
   in your `local.py`:

    ```python
    INSTALLED_APPS += ["aasovtool"]
    ```

3. Optional overrides (defaults shown):

    ```python
    AASOVTOOL_ALLOWED_REGIONS = ["pure blind", "fade", "deklein"]
    AASOVTOOL_DEFAULT_SCENARIO = "default"
    AASOVTOOL_REFRESH_INTERVAL_MINUTES = 30
    ```

4. Periodic refresh (add to `CELERYBEAT_SCHEDULE`):

    ```python
    from celery.schedules import crontab
    CELERYBEAT_SCHEDULE["aasovtool_refresh"] = {
        "task": "aasovtool.refresh_all",
        "schedule": crontab(minute="*/30"),
    }
    ```

5. Migrate, seed catalogs, and collect static:

    ```bash
    python manage.py migrate aasovtool
    python manage.py sovtool_seed
    python manage.py collectstatic --noinput
    ```

6. Restart `auth-supervisord` (`gunicorn` + `celery`) and the
   `Sovereignty` menu item will appear for any user with the
   `aasovtool.view_sovtool` permission.

## Permission model

| Role  | Django permissions                                                          | Notes                                                                  |
| ----- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| view  | `view_sovtool`                                                              | Read-only access to the planner + ESI data.                            |
| edit  | `view_sovtool` + `edit_sovtool`                                             | Plus per-region grants in `EditableRegion` table.                      |
| admin | `view_sovtool` + `edit_sovtool` + `manage_sovtool`                          | Can register ESI tokens, manage users, force refresh, edit all regions. |

Permissions can be assigned via the AA admin UI (the auto-created
`Sovtool Viewers / Editors / Admins` groups bundle them for one-click
provisioning).

## Registering a corporation ESI token

An admin (`manage_sovtool`) clicks **Add Corp Token** from the planner
page. They are redirected through CCP SSO with the following scopes:

- `publicData`
- `esi-corporations.read_structures.v1`
- `esi-universe.read_structures.v1`
- `esi-sovereignty.read_structures.v1`
- `esi-characters.read_corporation_roles.v1`

The token is associated with the character's corporation and used by
the Celery refresh tasks. Multiple corp tokens can be registered (one
per sov-holding corp).

## Building the frontend

The React bundle is committed under `aasovtool/static/aasovtool/`. To
rebuild it after editing the source:

```bash
cd frontend
npm install
npm run build   # writes hashed bundle into ../aasovtool/static/aasovtool/
```

For development you can run the Vite dev server (`npm run dev`) — it
proxies `/sovtool/api` to your local AA dev server.

## Layout / card positioning

The graph layout algorithm (`frontend/src/layout.ts`) and the React Flow
graph component (`frontend/src/components/SovereigntyGraph.tsx`) are
identical to the upstream project, so the system cards land in exactly
the same positions you've been planning against. Per-system manual
positions are persisted in the `SystemOverride.position` column of the
current scenario.

## Data refresh

```bash
python manage.py sovtool_refresh_esi
```

…will run a synchronous one-shot refresh; the normal Celery schedule
keeps the cache warm in production.

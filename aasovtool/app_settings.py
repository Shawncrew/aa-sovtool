"""Settings + ESI scopes for the sovtool AA app."""

from django.conf import settings


AASOVTOOL_ALLOWED_REGIONS = getattr(
    settings,
    "AASOVTOOL_ALLOWED_REGIONS",
    ["pure blind", "fade", "deklein"],
)

AASOVTOOL_DEFAULT_SCENARIO = getattr(
    settings,
    "AASOVTOOL_DEFAULT_SCENARIO",
    "default",
)

AASOVTOOL_ESI_SCOPES = [
    "publicData",
    "esi-corporations.read_structures.v1",
    "esi-universe.read_structures.v1",
    "esi-characters.read_corporation_roles.v1",
]
# Note: /sovereignty/* endpoints (campaigns/map/structures/systems) are
# public and require no scope. Access lists on Equinox structures are
# reached through esi-corporations.read_structures.v1.

AASOVTOOL_REFRESH_INTERVAL_MINUTES = getattr(
    settings,
    "AASOVTOOL_REFRESH_INTERVAL_MINUTES",
    30,
)

from django.urls import path

from . import views


app_name = "aasovtool"


urlpatterns = [
    path("", views.index, name="index"),
    # ESI token management
    path("tokens/add/", views.add_corp_token, name="add_corp_token"),
    path("tokens/callback/", views.corp_token_callback, name="corp_token_callback"),
    # JSON API used by the React SPA
    path("api/me", views.api_me, name="api_me"),
    path("api/systems", views.api_systems, name="api_systems"),
    path("api/upgrades", views.api_upgrades, name="api_upgrades"),
    path("api/scenarios", views.api_scenarios, name="api_scenarios"),
    path("api/scenarios/<str:name>", views.api_scenario_detail, name="api_scenario_detail"),
    path("api/users", views.api_users, name="api_users"),
    path("api/users/<str:username>", views.api_user_detail, name="api_user_detail"),
    # ESI live data
    path("api/sov/structures", views.api_sov_structures, name="api_sov_structures"),
    path("api/sov/systems", views.api_sov_systems, name="api_sov_systems"),
    path("api/corp/structures", views.api_corp_structures, name="api_corp_structures"),
    path("api/structures/<int:structure_id>/access_list",
         views.api_access_list, name="api_access_list"),
    path("api/refresh", views.api_refresh, name="api_refresh"),
]

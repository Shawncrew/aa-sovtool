import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("esi", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="General",
            fields=[
                ("id", models.AutoField(primary_key=True, serialize=False, auto_created=True)),
            ],
            options={
                "managed": False,
                "default_permissions": (),
                "permissions": (
                    ("view_sovtool", "Can view the sovereignty planner"),
                    ("edit_sovtool", "Can edit the sovereignty planner"),
                    ("manage_sovtool", "Can manage scenarios, users, and ESI tokens"),
                ),
            },
        ),
        migrations.CreateModel(
            name="System",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("system_name", models.CharField(db_index=True, max_length=64, unique=True)),
                ("star_id", models.BigIntegerField(blank=True, null=True)),
                ("region_name", models.CharField(db_index=True, max_length=64)),
                ("constellation_name", models.CharField(blank=True, max_length=64, null=True)),
                ("security", models.FloatField(default=0.0)),
                ("star_type", models.CharField(default="", max_length=64)),
                ("star_power", models.IntegerField(default=0)),
                ("planet_power", models.IntegerField(default=0)),
                ("workforce", models.IntegerField(default=0)),
                ("total_power", models.IntegerField(default=0)),
                ("coord_x", models.FloatField(default=0.0)),
                ("coord_y", models.FloatField(default=0.0)),
                ("coord_z", models.FloatField(default=0.0)),
                ("faction_id", models.IntegerField(blank=True, null=True)),
                ("base_superionic_ice_per_hour", models.IntegerField(default=0)),
                ("base_magmatic_gas_per_hour", models.IntegerField(default=0)),
                ("neighbors", models.JSONField(blank=True, default=list)),
            ],
            options={"ordering": ("system_name",)},
        ),
        migrations.CreateModel(
            name="Upgrade",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("type_id", models.IntegerField(db_index=True, unique=True)),
                ("upgrade_name", models.CharField(max_length=128)),
                ("power", models.IntegerField(default=0)),
                ("workforce", models.IntegerField(default=0)),
                ("superionic_ice_per_hour", models.IntegerField(default=0)),
                ("magmatic_gas_per_hour", models.IntegerField(default=0)),
            ],
            options={"ordering": ("upgrade_name",)},
        ),
        migrations.CreateModel(
            name="Scenario",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("name", models.CharField(max_length=128, unique=True)),
                ("description", models.TextField(blank=True, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("is_default", models.BooleanField(default=False)),
            ],
            options={"ordering": ("-updated_at",)},
        ),
        migrations.CreateModel(
            name="SystemOverride",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("system_name", models.CharField(db_index=True, max_length=64)),
                ("role", models.CharField(blank=True, choices=[("export", "Export"), ("import", "Import"), ("transit", "Transit")], max_length=16, null=True)),
                ("upgrades", models.JSONField(blank=True, default=list)),
                ("transfers", models.JSONField(blank=True, default=list)),
                ("position", models.JSONField(blank=True, null=True)),
                ("ansiblex_partner", models.CharField(blank=True, max_length=64, null=True)),
                ("scenario", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="overrides", to="aasovtool.scenario")),
            ],
            options={"unique_together": {("scenario", "system_name")}},
        ),
        migrations.CreateModel(
            name="EditableRegion",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("region_name", models.CharField(max_length=64)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sovtool_regions", to=settings.AUTH_USER_MODEL)),
            ],
            options={"unique_together": {("user", "region_name")}},
        ),
        migrations.CreateModel(
            name="CorpToken",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("corporation_id", models.IntegerField(unique=True)),
                ("corporation_name", models.CharField(max_length=128)),
                ("character_id", models.IntegerField()),
                ("character_name", models.CharField(max_length=128)),
                ("added_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("last_used_at", models.DateTimeField(blank=True, null=True)),
                ("is_enabled", models.BooleanField(default=True)),
                ("added_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
                ("esi_token", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="esi.token")),
            ],
        ),
        migrations.CreateModel(
            name="SovStructure",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("structure_id", models.BigIntegerField(unique=True)),
                ("structure_type_id", models.IntegerField()),
                ("structure_type_name", models.CharField(blank=True, max_length=128)),
                ("solar_system_id", models.IntegerField(db_index=True)),
                ("solar_system_name", models.CharField(blank=True, max_length=64)),
                ("alliance_id", models.IntegerField(blank=True, null=True)),
                ("corporation_id", models.IntegerField(blank=True, null=True)),
                ("vulnerability_occupancy_level", models.FloatField(blank=True, null=True)),
                ("vulnerable_start_time", models.DateTimeField(blank=True, null=True)),
                ("vulnerable_end_time", models.DateTimeField(blank=True, null=True)),
                ("activity_defense_multiplier", models.FloatField(blank=True, null=True)),
                ("activity_defense_breakdown", models.JSONField(blank=True, default=dict)),
                ("is_raidable", models.BooleanField(default=False)),
                ("raidable_until", models.DateTimeField(blank=True, null=True)),
                ("last_seen_at", models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
        migrations.CreateModel(
            name="CorpStructure",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("structure_id", models.BigIntegerField(unique=True)),
                ("corporation_id", models.IntegerField(db_index=True)),
                ("type_id", models.IntegerField()),
                ("type_name", models.CharField(blank=True, max_length=128)),
                ("system_id", models.IntegerField()),
                ("system_name", models.CharField(blank=True, max_length=64)),
                ("profile_id", models.IntegerField(blank=True, null=True)),
                ("state", models.CharField(blank=True, max_length=64)),
                ("state_timer_start", models.DateTimeField(blank=True, null=True)),
                ("state_timer_end", models.DateTimeField(blank=True, null=True)),
                ("fuel_expires", models.DateTimeField(blank=True, null=True)),
                ("unanchors_at", models.DateTimeField(blank=True, null=True)),
                ("services", models.JSONField(blank=True, default=list)),
                ("last_seen_at", models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
        migrations.CreateModel(
            name="AccessList",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("access_list_id", models.BigIntegerField(unique=True)),
                ("structure_id", models.BigIntegerField(db_index=True)),
                ("name", models.CharField(blank=True, max_length=128)),
                ("description", models.TextField(blank=True)),
                ("owner_id", models.IntegerField(blank=True, null=True)),
                ("last_seen_at", models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
        migrations.CreateModel(
            name="AccessListMember",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("entity_id", models.IntegerField()),
                ("entity_type", models.CharField(choices=[("character", "Character"), ("corporation", "Corporation"), ("alliance", "Alliance")], max_length=16)),
                ("entity_name", models.CharField(blank=True, max_length=128)),
                ("is_blocked", models.BooleanField(default=False)),
                ("access_list", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="members", to="aasovtool.accesslist")),
            ],
            options={"unique_together": {("access_list", "entity_id", "entity_type")}},
        ),
        migrations.CreateModel(
            name="AuditEntry",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False, auto_created=True)),
                ("username", models.CharField(max_length=64)),
                ("timestamp", models.DateTimeField(default=django.utils.timezone.now)),
                ("message", models.TextField()),
                ("scenario", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="audit_entries", to="aasovtool.scenario")),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-timestamp",)},
        ),
    ]

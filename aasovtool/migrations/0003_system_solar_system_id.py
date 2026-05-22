from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("aasovtool", "0002_sovstructure_hub_detail"),
    ]

    operations = [
        migrations.AddField(
            model_name="system",
            name="solar_system_id",
            field=models.IntegerField(blank=True, null=True, db_index=True),
        ),
    ]

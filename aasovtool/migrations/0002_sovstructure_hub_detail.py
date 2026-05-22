from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("aasovtool", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="sovstructure",
            name="hub_detail",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]

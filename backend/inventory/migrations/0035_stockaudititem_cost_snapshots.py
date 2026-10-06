from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0034_mraproductmapping_is_product'),
    ]

    operations = [
        migrations.AddField(
            model_name='stockaudititem',
            name='unit_cost_snapshot',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='stockaudititem',
            name='discrepancy_value_snapshot',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
    ]

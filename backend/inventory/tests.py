from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from business.models import Branch, Business, BusinessSettings
from inventory.models import InventoryItem, MRAProductMapping, StockTransfer
from inventory.services import InventoryService
from staff.models import Staff, StaffRole

User = get_user_model()


class MRAProductMappingCreateTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='owner@example.com', password='test123')
        self.client.force_authenticate(user=self.user)

        self.business = Business.objects.create(owner=self.user, name='Test Business', vat_registered=True, mra_taxpayer_type='VAT')
        self.branch = Branch.objects.create(
            business=self.business,
            name='Main Branch',
            address='123 Main St',
            city='Lilongwe',
            country='Malawi',
        )

        self.item_1 = InventoryItem.objects.create(
            business=self.business,
            branch=self.branch,
            name='Sugar 1kg',
            category='Grocery',
            item_type='sellable',
            price=Decimal('3000.00'),
        )
        self.item_2 = InventoryItem.objects.create(
            business=self.business,
            branch=self.branch,
            name='Rice 1kg',
            category='Grocery',
            item_type='sellable',
            price=Decimal('4500.00'),
        )

        self.url = '/api/inventory/mra-mappings/'

    def test_single_mapping_create_still_works(self):
        payload = {
            'inventory_item_id': str(self.item_1.id),
            'mra_product_code': 'GROC-001',
            'mra_product_name': 'Sugar',
            'mra_tax_type': 'standard',
            'mra_tax_rate': '16.50',
            'mra_unit_measure': 'unit',
            'tax_calculation_method': 'inclusive',
        }

        response = self.client.post(self.url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        mapping = MRAProductMapping.objects.get(inventory_item=self.item_1)
        self.assertEqual(mapping.mra_product_code, 'GROC-001')
        self.assertEqual(mapping.tax_calculation_method, 'inclusive')
        self.assertEqual(mapping.mra_tax_rate, Decimal('16.50'))

    def test_non_vat_business_allows_mra_standard_vat_mapping_create(self):
        self.business.mra_taxpayer_type = 'NON_VAT'
        self.business.vat_registered = False
        self.business.save(update_fields=['mra_taxpayer_type', 'vat_registered', 'updated_at'])
        payload = {
            'inventory_item_id': str(self.item_1.id),
            'mra_product_code': 'GROC-001',
            'mra_product_name': 'Sugar',
            'mra_tax_type': 'standard',
            'mra_tax_rate': '17.50',
            'mra_unit_measure': 'unit',
            'tax_calculation_method': 'inclusive',
        }

        response = self.client.post(self.url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        mapping = MRAProductMapping.objects.get(inventory_item=self.item_1)
        self.assertEqual(mapping.mra_tax_type, 'standard')
        self.assertEqual(mapping.mra_tax_rate, Decimal('17.50'))
        self.assertTrue(mapping.is_taxpayer_compatible())

    def test_bulk_mapping_create_supports_per_row_tax_configuration(self):
        payload = {
            'mappings': [
                {
                    'inventory_item_id': str(self.item_1.id),
                    'mra_product_code': 'GROC-001',
                    'mra_product_name': 'Sugar',
                    'mra_tax_type': 'standard',
                    'mra_tax_rate': '16.50',
                    'mra_unit_measure': 'unit',
                    'tax_calculation_method': 'exclusive',
                },
                {
                    'inventory_item_id': str(self.item_2.id),
                    'mra_product_code': 'GROC-002',
                    'mra_product_name': 'Rice',
                    'mra_tax_type': 'zero',
                    'mra_tax_rate': '0.00',
                    'mra_unit_measure': 'kg',
                    'tax_calculation_method': 'exclusive',
                },
            ]
        }

        response = self.client.post(self.url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data.get('count'), 2)

        first_mapping = MRAProductMapping.objects.get(inventory_item=self.item_1)
        second_mapping = MRAProductMapping.objects.get(inventory_item=self.item_2)

        self.assertEqual(first_mapping.mra_tax_rate, Decimal('16.50'))
        self.assertEqual(first_mapping.tax_calculation_method, 'exclusive')

        self.assertEqual(second_mapping.mra_tax_rate, Decimal('0.00'))
        # Zero/exempt rows are normalized to inclusive by serializer validation.
        self.assertEqual(second_mapping.tax_calculation_method, 'inclusive')
        self.assertEqual(second_mapping.mra_unit_measure, 'kg')

    def test_bulk_mapping_rejects_existing_mappings_without_partial_writes(self):
        MRAProductMapping.objects.create(
            inventory_item=self.item_1,
            branch=self.branch,
            mra_product_code='GROC-EXIST',
            mra_product_name='Sugar Existing',
            mra_tax_type='standard',
            mra_tax_rate=Decimal('16.50'),
            mra_unit_measure='unit',
            tax_calculation_method='inclusive',
            is_approved=False,
            mra_synced=False,
        )

        payload = {
            'mappings': [
                {
                    'inventory_item_id': str(self.item_1.id),
                    'mra_product_code': 'GROC-001',
                    'mra_product_name': 'Sugar',
                    'mra_tax_type': 'standard',
                    'mra_tax_rate': '16.50',
                    'mra_unit_measure': 'unit',
                    'tax_calculation_method': 'inclusive',
                },
                {
                    'inventory_item_id': str(self.item_2.id),
                    'mra_product_code': 'GROC-002',
                    'mra_product_name': 'Rice',
                    'mra_tax_type': 'standard',
                    'mra_tax_rate': '16.50',
                    'mra_unit_measure': 'unit',
                    'tax_calculation_method': 'inclusive',
                },
            ]
        }

        response = self.client.post(self.url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(str(self.item_1.id), response.data.get('inventory_item_ids', []))
        # Ensure no partial writes for remaining items.
        self.assertFalse(MRAProductMapping.objects.filter(inventory_item=self.item_2).exists())

    def test_manual_mapping_create_rejected_when_eis_enabled(self):
        BusinessSettings.objects.create(business=self.business, enable_eis=True)
        payload = {
            'inventory_item_id': str(self.item_1.id),
            'mra_product_code': 'GROC-001',
            'mra_product_name': 'Sugar',
            'mra_tax_type': 'standard',
            'mra_tax_rate': '16.50',
            'mra_unit_measure': 'unit',
            'tax_calculation_method': 'inclusive',
        }

        response = self.client.post(self.url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(MRAProductMapping.objects.filter(inventory_item=self.item_1).exists())
        self.assertIn('sync-from-eis-catalog', str(response.data))

    def test_manual_mapping_mutations_rejected_when_eis_enabled(self):
        BusinessSettings.objects.create(business=self.business, enable_eis=True)
        mapping = MRAProductMapping.objects.create(
            inventory_item=self.item_1,
            branch=self.branch,
            mra_product_code='GROC-EXIST',
            mra_product_name='Sugar Existing',
            mra_tax_type='standard',
            mra_tax_rate=Decimal('16.50'),
            mra_unit_measure='unit',
            tax_calculation_method='inclusive',
            is_approved=True,
            mra_synced=True,
        )

        update_response = self.client.patch(
            f'{self.url}{mapping.id}/',
            {'mra_tax_rate': '0.00'},
            format='json',
        )
        approve_response = self.client.post(
            f'{self.url}{mapping.id}/approve/',
            {'is_approved': True, 'mra_synced': True},
            format='json',
        )
        sync_response = self.client.post(f'{self.url}{mapping.id}/sync/', {}, format='json')
        delete_response = self.client.delete(f'{self.url}{mapping.id}/')

        self.assertEqual(update_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(approve_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(sync_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(delete_response.status_code, status.HTTP_403_FORBIDDEN)
        mapping.refresh_from_db()
        self.assertEqual(mapping.mra_tax_rate, Decimal('16.50'))


class StockTransferWithoutEISTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='transfer-owner@example.com', password='test123')
        self.business = Business.objects.create(
            owner=self.user,
            name='Transfer Business',
            mra_enrolled=True,
        )
        # Explicitly disabled EIS must take precedence over the legacy
        # enrollment flag. Branch transfers remain a local inventory action.
        BusinessSettings.objects.create(business=self.business, enable_eis=False)
        self.from_branch = Branch.objects.create(
            business=self.business,
            name='Source Branch',
            address='Source address',
            city='Lilongwe',
            country='Malawi',
        )
        self.to_branch = Branch.objects.create(
            business=self.business,
            name='Destination Branch',
            address='Destination address',
            city='Lilongwe',
            country='Malawi',
        )
        self.item = InventoryItem.objects.create(
            business=self.business,
            branch=self.from_branch,
            name='Transfer Item',
            category='Grocery',
            item_type='sellable',
            stock_units=Decimal('10'),
            price=Decimal('100'),
        )

    def test_branch_transfer_does_not_require_eis_when_disabled(self):
        transfer = InventoryService.transfer_stock(
            from_branch=self.from_branch,
            to_branch=self.to_branch,
            inventory_item=self.item,
            quantity=Decimal('3'),
            transfer_reference='TRF-NO-EIS-001',
            user=self.user,
        )

        self.assertIsInstance(transfer, StockTransfer)
        self.assertFalse(transfer.mra_notified)
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock_units, Decimal('7'))
        destination_item = InventoryItem.objects.get(
            business=self.business,
            branch=self.to_branch,
            name='Transfer Item',
        )
        self.assertEqual(destination_item.stock_units, Decimal('3'))


class StockTransferCrossDeviceVisibilityTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email='transfer-sync-owner@example.com', password='test123')
        self.cashier = User.objects.create_user(email='transfer-sync-cashier@example.com', password='test123')
        self.business = Business.objects.create(owner=self.owner, name='Transfer Sync Business')
        BusinessSettings.objects.create(business=self.business, enable_eis=False)
        self.from_branch = Branch.objects.create(
            business=self.business,
            name='Source Branch',
            address='Source address',
            city='Lilongwe',
            country='Malawi',
        )
        self.to_branch = Branch.objects.create(
            business=self.business,
            name='Destination Branch',
            address='Destination address',
            city='Lilongwe',
            country='Malawi',
        )
        Staff.objects.create(
            business=self.business,
            branch=self.to_branch,
            user=self.cashier,
            name='Transfer Cashier',
            email=self.cashier.email,
            role=StaffRole.CASHIER,
            is_active=True,
        )
        item = InventoryItem.objects.create(
            business=self.business,
            branch=self.from_branch,
            name='Cross Device Item',
            category='Grocery',
            item_type='sellable',
            stock_units=Decimal('10'),
            price=Decimal('100'),
        )
        self.transfer = InventoryService.transfer_stock(
            from_branch=self.from_branch,
            to_branch=self.to_branch,
            inventory_item=item,
            quantity=Decimal('2'),
            transfer_reference='TRF-CROSS-DEVICE-001',
            user=self.owner,
        )

    def test_staff_can_see_transfers_for_destination_branch(self):
        self.client.force_authenticate(user=self.cashier)

        response = self.client.get(
            f'/api/inventory/transfers/?branch_id={self.to_branch.id}'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json() if hasattr(response, 'json') else response.data
        transfer_rows = payload.get('results', payload) if isinstance(payload, dict) else payload
        returned_ids = {str(row['id']) for row in transfer_rows}
        self.assertIn(str(self.transfer.id), returned_ids)
        self.assertEqual(transfer_rows[0]['inventory_item_name'], 'Cross Device Item')

    def test_inventory_sync_pull_includes_branch_transfers(self):
        self.client.force_authenticate(user=self.cashier)

        response = self.client.get(
            f'/api/inventory/sync/pull/?since=2000-01-01T00:00:00Z&branch_id={self.to_branch.id}'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        transfer_rows = response.data['changes']['stock_transfers']
        self.assertEqual(len(transfer_rows), 1)
        self.assertEqual(str(transfer_rows[0]['id']), str(self.transfer.id))

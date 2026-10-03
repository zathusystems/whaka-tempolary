from decimal import Decimal
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from business.models import Branch, Business
from system_config.models import SystemConfig
from subscription.models import (
    Deposit,
    FeaturePricing,
    Invoice,
    Subscription,
    SubscriptionFeature,
)
from subscription.utils import process_invoice_payment


class SubscriptionModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='owner@example.com', password='testpass123')
        self.business = Business.objects.create(owner=self.user, name='Model Biz', country='USA')
        self.subscription = Subscription.objects.create(
            business=self.business,
            status='active',
            account_balance=Decimal('100.00'),
            free_trial_credits_applied=True,
            free_trial_end_date=timezone.now() - timedelta(days=1),
        )
        config = SystemConfig.get_config()
        config.base_subscription_price_per_day_usd = Decimal('5.00')
        config.enable_feature_pricing = True
        config.save()

    def test_deduct_credit_allows_paid_balance_after_trial_expiry(self):
        deducted = self.subscription.deduct_credit(Decimal('10.00'))
        self.subscription.refresh_from_db()

        self.assertTrue(deducted)
        self.assertEqual(self.subscription.account_balance, Decimal('90.00'))

    def test_apply_daily_charges_works_after_trial_expiry(self):
        success, message = self.subscription.apply_daily_charges()
        self.subscription.refresh_from_db()

        self.assertTrue(success, message)
        self.assertEqual(self.subscription.account_balance, Decimal('95.00'))
        self.assertEqual(self.subscription.total_spent, Decimal('5.00'))
        self.assertIsNotNone(self.subscription.last_charge_date)

    def test_process_invoice_payment_returns_false_when_invoicing_disabled(self):
        invoice = Invoice.objects.create(
            subscription=self.subscription,
            invoice_number='INV-IDEMPOTENT-1',
            amount=Decimal('20.00'),
            status='sent',
            billing_period_start=timezone.now() - timedelta(days=30),
            billing_period_end=timezone.now(),
            due_date=timezone.now() + timedelta(days=7),
        )

        first = process_invoice_payment(invoice)
        self.subscription.refresh_from_db()
        invoice.refresh_from_db()

        self.assertFalse(first)
        self.assertEqual(self.subscription.account_balance, Decimal('100.00'))
        self.assertEqual(invoice.status, 'sent')
        self.assertEqual(self.subscription.usage_charges.count(), 0)


class SubscriptionAdminTests(TestCase):
    def setUp(self):
        self.admin_user = User.objects.create_superuser(
            email='admin@example.com',
            password='testpass123',
        )
        owner = User.objects.create_user(email='admin-owner@example.com', password='testpass123')
        business = Business.objects.create(owner=owner, name='Admin Test Biz', country='USA')
        Subscription.objects.create(
            business=business,
            status='active',
            account_balance=Decimal('25.00'),
        )

    def test_subscription_changelist_renders(self):
        self.client.force_login(self.admin_user)
        response = self.client.get('/admin/subscription/subscription/')
        self.assertEqual(response.status_code, 200)


class SubscriptionApiTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email='api-owner@example.com', password='testpass123')
        self.other_user = User.objects.create_user(email='other@example.com', password='testpass123')
        self.business = Business.objects.create(owner=self.owner, name='Owner Biz', country='USA')
        self.business_two = Business.objects.create(owner=self.owner, name='Owner Biz Two', country='USA')
        self.other_business = Business.objects.create(owner=self.other_user, name='Other Biz', country='USA')
        self.client.force_authenticate(user=self.owner)

        config = SystemConfig.get_config()
        config.base_subscription_price_per_day_usd = Decimal('5.00')
        config.enable_feature_pricing = True
        config.save()

    def test_create_subscription_rejects_business_not_owned_by_user(self):
        response = self.client.post(
            '/api/subscription/subscriptions/',
            {'business': self.other_business.id},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_create_subscription_seeds_subscription_features_from_flags(self):
        feature_pos = FeaturePricing.objects.create(feature='pos', price_per_day=Decimal('1.00'), is_active=True)
        feature_inventory = FeaturePricing.objects.create(
            feature='inventory',
            price_per_day=Decimal('2.00'),
            is_active=True,
        )

        response = self.client.post(
            '/api/subscription/subscriptions/',
            {'business': self.business.id},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)

        subscription = Subscription.objects.get(business=self.business)
        self.assertTrue(
            SubscriptionFeature.objects.filter(
                subscription=subscription, feature=feature_pos, enabled=True
            ).exists()
        )
        self.assertTrue(
            SubscriptionFeature.objects.filter(
                subscription=subscription, feature=feature_inventory, enabled=True
            ).exists()
        )

    def test_trial_preview_matches_created_subscription_credits(self):
        FeaturePricing.objects.create(feature='pos', price_per_day=Decimal('1.00'), is_active=True)
        FeaturePricing.objects.create(feature='inventory', price_per_day=Decimal('2.00'), is_active=True)
        expected_credits = Decimal('240.00')  # (base 5 + features 3) * 30 days

        preview_response = self.client.get(
            '/api/subscription/subscriptions/trial-preview/',
            {'business': self.business.id},
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.data)
        self.assertEqual(preview_response.data['free_trial_days'], 30)
        self.assertEqual(
            Decimal(str(preview_response.data['free_trial_credits_amount'])),
            expected_credits,
        )

        create_response = self.client.post(
            '/api/subscription/subscriptions/',
            {'business': self.business.id},
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        self.assertEqual(
            Decimal(str(create_response.data['free_trial_credits_amount'])),
            expected_credits,
        )
        self.assertEqual(
            Decimal(str(create_response.data['account_balance'])),
            expected_credits,
        )

    def test_invoice_api_returns_empty_when_invoicing_disabled(self):
        subscription = Subscription.objects.create(
            business=self.business,
            status='active',
            account_balance=Decimal('100.00'),
        )
        Invoice.objects.create(
            subscription=subscription,
            invoice_number='INV-BILLING-1',
            amount=Decimal('15.00'),
            status='sent',
            billing_period_start=timezone.now() - timedelta(days=30),
            billing_period_end=timezone.now(),
            due_date=timezone.now() + timedelta(days=7),
        )

        response = self.client.get('/api/subscription/invoices/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['results'], [])

    def test_subscription_features_list_bootstraps_from_legacy_flags(self):
        FeaturePricing.objects.create(feature='pos', price_per_day=Decimal('1.00'), is_active=True)
        subscription = Subscription.objects.create(
            business=self.business,
            status='active',
            account_balance=Decimal('20.00'),
            enable_pos=True,
        )
        self.assertEqual(subscription.enabled_features.count(), 0)

        response = self.client.get('/api/subscription/subscription-features/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertGreaterEqual(len(response.data['results']), 1)
        self.assertTrue(
            SubscriptionFeature.objects.filter(
                subscription=subscription,
                feature__feature='pos',
                enabled=True,
            ).exists()
        )

    def test_pause_and_deposit_work_with_multiple_subscriptions(self):
        sub_one = Subscription.objects.create(
            business=self.business,
            status='active',
            account_balance=Decimal('50.00'),
        )
        sub_two = Subscription.objects.create(
            business=self.business_two,
            status='active',
            account_balance=Decimal('75.00'),
        )

        pause_response = self.client.post(
            '/api/subscription/subscriptions/pause/',
            {'business': self.business_two.id},
            format='json',
        )
        self.assertEqual(pause_response.status_code, 200, pause_response.data)
        sub_one.refresh_from_db()
        sub_two.refresh_from_db()
        self.assertEqual(sub_one.status, 'active')
        self.assertEqual(sub_two.status, 'paused')

        deposit_response = self.client.post(
            '/api/subscription/deposits/',
            {
                'business': self.business_two.id,
                'amount': '10.00',
                'payment_method': 'manual',
                'transaction_id': 'MANUAL-TOPUP-001',
                'payment_proof': 'manual-topup',
            },
            format='json',
        )
        self.assertEqual(deposit_response.status_code, 201, deposit_response.data)
        deposit = Deposit.objects.get(id=deposit_response.data['id'])
        self.assertEqual(deposit.subscription_id, sub_two.id)

    def test_current_endpoint_applies_pending_daily_charges(self):
        subscription = Subscription.objects.create(
            business=self.business,
            status='active',
            account_balance=Decimal('100.00'),
        )

        # Simulate a subscription that started in the past but has never been charged.
        past_start = timezone.now() - timedelta(days=3, hours=1)
        Subscription.objects.filter(pk=subscription.pk).update(
            start_date=past_start,
            last_charge_date=None,
            total_spent=Decimal('0.00'),
        )
        subscription.refresh_from_db()

        pending_days = subscription.get_pending_daily_charge_days()
        self.assertGreaterEqual(pending_days, 1)
        expected_daily = subscription.calculate_daily_charges()
        expected_total_spent = expected_daily * pending_days

        response = self.client.get(
            '/api/subscription/subscriptions/current/',
            {'business': self.business.id},
        )
        self.assertEqual(response.status_code, 200, response.data)

        subscription.refresh_from_db()
        self.assertEqual(subscription.total_spent, expected_total_spent)
        self.assertEqual(subscription.account_balance, Decimal('100.00') - expected_total_spent)
        self.assertIsNotNone(subscription.last_charge_date)

    def test_dashboard_summary_applies_daily_charge_only_once_per_day(self):
        dashboard_business = self.business_two
        initial_balance = Decimal('500000.00')
        branch = Branch.objects.create(
            business=dashboard_business,
            name='Main Branch',
            address='Default Address',
            city='Blantyre',
            country='Malawi',
        )
        subscription = Subscription.objects.create(
            business=dashboard_business,
            status='active',
            account_balance=initial_balance,
        )

        # Simulate multiple missed days so first dashboard load performs catch-up.
        past_start = timezone.now() - timedelta(days=2, hours=1)
        Subscription.objects.filter(pk=subscription.pk).update(
            start_date=past_start,
            last_charge_date=None,
            total_spent=Decimal('0.00'),
        )
        subscription.refresh_from_db()

        pending_days = subscription.get_pending_daily_charge_days()
        self.assertGreaterEqual(pending_days, 1)
        expected_daily = subscription.calculate_daily_charges()
        expected_total_spent = expected_daily * pending_days

        first_response = self.client.get(
            '/api/business/dashboard/summary/',
            {'branch_id': branch.id},
        )
        self.assertEqual(first_response.status_code, 200, first_response.data)

        subscription.refresh_from_db()
        self.assertEqual(subscription.total_spent, expected_total_spent)
        self.assertEqual(subscription.account_balance, initial_balance - expected_total_spent)
        self.assertEqual(subscription.usage_charges.count(), 1)

        # A second dashboard load on the same day must not deduct again.
        second_response = self.client.get(
            '/api/business/dashboard/summary/',
            {'branch_id': branch.id},
        )
        self.assertEqual(second_response.status_code, 200, second_response.data)

        subscription.refresh_from_db()
        self.assertEqual(subscription.total_spent, expected_total_spent)
        self.assertEqual(subscription.account_balance, initial_balance - expected_total_spent)
        self.assertEqual(subscription.usage_charges.count(), 1)

    def test_deposit_creation_requires_transaction_id(self):
        Subscription.objects.create(
            business=self.business,
            status='active',
            account_balance=Decimal('20.00'),
        )

        response = self.client.post(
            '/api/subscription/deposits/',
            {
                'business': self.business.id,
                'amount': '10.00',
                'payment_method': 'manual',
                'payment_proof': 'manual-topup',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('transaction_id', response.data)

    def test_deposit_creation_defaults_payment_proof_to_transaction_id(self):
        subscription = Subscription.objects.create(
            business=self.business,
            status='active',
            account_balance=Decimal('20.00'),
        )

        response = self.client.post(
            '/api/subscription/deposits/',
            {
                'business': self.business.id,
                'amount': '10.00',
                'payment_method': 'manual',
                'transaction_id': 'MANUAL-TOPUP-002',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        deposit = Deposit.objects.get(id=response.data['id'])
        self.assertEqual(deposit.subscription_id, subscription.id)
        self.assertEqual(deposit.payment_proof, 'MANUAL-TOPUP-002')

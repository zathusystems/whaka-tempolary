from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.db.utils import OperationalError
from django.utils import timezone
from datetime import timedelta
from .models import Subscription, Invoice, Deposit, DepositStatus, SubscriptionFeature, FeaturePricing
from system_config.models import SystemConfig
from business.models import Business
import logging
from .serializers import (
    SubscriptionSerializer, InvoiceSerializer, DepositSerializer, 
    DepositCreateSerializer, SubscriptionFeatureSerializer, FeaturePricingSerializer,
    SubscriptionUpdateSerializer,
)

logger = logging.getLogger(__name__)

class SubscriptionViewSet(viewsets.ModelViewSet):
    serializer_class = SubscriptionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Get subscriptions for businesses owned by current user
        return Subscription.objects.filter(business__owner=self.request.user)

    def get_serializer_class(self):
        if self.action in {'update', 'partial_update'}:
            return SubscriptionUpdateSerializer
        return SubscriptionSerializer

    def perform_update(self, serializer):
        subscription = serializer.save()
        subscription.sync_feature_assignments_from_flags()

    def _resolve_subscription(self, request):
        business_id = request.data.get('business') or request.query_params.get('business')
        subscriptions = Subscription.objects.filter(business__owner=request.user).order_by('id')
        if business_id:
            subscriptions = subscriptions.filter(business_id=business_id)
        return subscriptions.first()

    def _resolve_owned_business(self, request):
        business_id = request.data.get('business') or request.query_params.get('business')
        if not business_id:
            return None, Response(
                {'detail': 'business ID is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            business = Business.objects.get(id=business_id, owner=request.user)
        except Business.DoesNotExist:
            return None, Response(
                {'detail': 'Business not found or not owned by user'},
                status=status.HTTP_403_FORBIDDEN
            )

        return business, None

    def _calculate_trial_credit_details(self, business):
        config = SystemConfig.get_config()

        business_country = (getattr(business, 'country', '') or '').strip().lower()
        is_malawi = business_country in {'malawi', 'mw', 'mwi'} or 'malawi' in business_country
        currency_code = (
            config.malawi_currency_code
            if is_malawi
            else config.international_currency_code
        )

        base_price = (
            config.base_subscription_price_per_day_mwk
            if currency_code == config.malawi_currency_code
            else config.base_subscription_price_per_day_usd
        )

        free_trial_days = 30
        total_daily_charge = base_price
        active_feature_count = 0

        if config.enable_feature_pricing:
            feature_pricings = FeaturePricing.objects.filter(is_active=True)
            active_feature_count = feature_pricings.count()
            for feature_pricing in feature_pricings:
                total_daily_charge += feature_pricing.price_per_day or 0

        free_trial_credits = total_daily_charge * free_trial_days
        free_trial_end_date = timezone.now() + timedelta(days=free_trial_days)

        return {
            'currency_code': currency_code,
            'base_price_per_day': base_price,
            'total_daily_charge': total_daily_charge,
            'free_trial_days': free_trial_days,
            'free_trial_credits_amount': free_trial_credits,
            'free_trial_end_date': free_trial_end_date,
            'active_feature_count': active_feature_count,
            'feature_pricing_enabled': config.enable_feature_pricing,
        }

    @action(detail=False, methods=['get'], url_path='trial-preview')
    def trial_preview(self, request):
        """Preview trial credits for a business before subscription creation."""
        business, error_response = self._resolve_owned_business(request)
        if error_response:
            return error_response

        trial_details = self._calculate_trial_credit_details(business)
        return Response({
            'business': business.id,
            'currency_code': trial_details['currency_code'],
            'base_price_per_day': float(trial_details['base_price_per_day']),
            'total_daily_charge': float(trial_details['total_daily_charge']),
            'free_trial_days': trial_details['free_trial_days'],
            'free_trial_credits_amount': float(trial_details['free_trial_credits_amount']),
            'free_trial_end_date': trial_details['free_trial_end_date'].isoformat(),
            'active_feature_count': trial_details['active_feature_count'],
            'feature_pricing_enabled': trial_details['feature_pricing_enabled'],
        })

    def create(self, request, *args, **kwargs):
        """Create a new subscription with free trial credits"""
        print(f"[SUBSCRIPTION] create() called with data: {request.data}")
        business, error_response = self._resolve_owned_business(request)
        if error_response:
            print("[SUBSCRIPTION] Invalid business in request")
            return error_response

        # Check if subscription already exists for this business
        existing = Subscription.objects.filter(business_id=business.id).first()
        if existing:
            print(f"[SUBSCRIPTION] Subscription already exists for business {business.id}")
            return Response(
                {'detail': f'Subscription for this business already exists (ID: {existing.id})'},
                status=status.HTTP_400_BAD_REQUEST
            )

        trial_details = self._calculate_trial_credit_details(business)
        free_trial_days = trial_details['free_trial_days']
        free_trial_credits = trial_details['free_trial_credits_amount']
        free_trial_end_date = trial_details['free_trial_end_date']
        base_price = trial_details['base_price_per_day']

        # Create a mutable copy of request data with free trial fields
        data = dict(request.data)
        data['status'] = 'active'  # Use 'active' status, not 'trial'
        data['base_price_per_day'] = float(base_price)
        data['account_balance'] = float(free_trial_credits)
        data['free_trial_days'] = free_trial_days
        data['free_trial_credits_applied'] = True
        data['free_trial_credits_amount'] = float(free_trial_credits)
        data['free_trial_end_date'] = free_trial_end_date.isoformat()
        
        print(f"[SUBSCRIPTION] Creating subscription with data: {data}")
        
        # Use the serializer directly with the modified data
        serializer = self.get_serializer(data=data)
        if not serializer.is_valid():
            print(f"[SUBSCRIPTION] Serializer errors: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        with transaction.atomic():
            self.perform_create(serializer)
            serializer.instance.sync_feature_assignments_from_flags()
        headers = self.get_success_headers(serializer.data)
        
        print(f"[SUBSCRIPTION] Created subscription for business '{business.name}' (ID: {business.id})")
        print(f"[SUBSCRIPTION] Free trial credits applied: {free_trial_credits}")
        print(f"[SUBSCRIPTION] Free trial period: {free_trial_days} days (until {free_trial_end_date.strftime('%Y-%m-%d')})")
        print(f"[SUBSCRIPTION] Daily charge: {base_price}")
        print(f"[SUBSCRIPTION] Account balance set to: {free_trial_credits}")
        
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
    
    @action(detail=False, methods=['get'])
    def current(self, request):
        """Get current user's subscription"""
        try:
            subscription = self._resolve_subscription(request)
            
            if not subscription:
                return Response(
                    {'detail': 'No subscription found'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # Best effort; don't fail GET due to SQLite write-lock races.
            try:
                # Apply missed daily charges on read to keep billing up-to-date
                # even when periodic jobs are delayed.
                charged, message, charged_days, charged_amount = subscription.apply_pending_daily_charges()
                if charged:
                    logger.info(
                        "[SUBSCRIPTION] Catch-up billing applied on current(): business=%s, days=%s, amount=%s",
                        subscription.business_id,
                        charged_days,
                        charged_amount,
                    )
                else:
                    logger.debug("[SUBSCRIPTION] Catch-up billing skipped on current(): %s", message)
                subscription.sync_feature_assignments_from_flags()
            except OperationalError as exc:
                logger.warning("Skipping subscription feature sync on current(): %s", exc)
            except Exception as exc:
                logger.warning("Skipping catch-up billing on current(): %s", exc)
            
            serializer = self.get_serializer(subscription)
            return Response(serializer.data)
        except Exception as e:
            import traceback
            print(f"[SUBSCRIPTION] Error in current endpoint: {str(e)}")
            print(f"[SUBSCRIPTION] Traceback: {traceback.format_exc()}")
            return Response(
                {'detail': f'Error retrieving subscription: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'])
    def pause(self, request):
        """Pause subscription"""
        subscription = self._resolve_subscription(request)
        if not subscription:
            return Response(
                {'detail': 'No subscription found'},
                status=status.HTTP_404_NOT_FOUND
            )

        subscription.status = 'paused'
        subscription.save(update_fields=['status', 'updated_at'])
        serializer = self.get_serializer(subscription)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def resume(self, request):
        """Resume subscription"""
        subscription = self._resolve_subscription(request)
        if not subscription:
            return Response(
                {'detail': 'No subscription found'},
                status=status.HTTP_404_NOT_FOUND
            )

        subscription.status = 'active'
        subscription.save(update_fields=['status', 'updated_at'])
        serializer = self.get_serializer(subscription)
        return Response(serializer.data)


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Subscription invoice flow is disabled in favor of direct daily charging.
        return Invoice.objects.none()


class DepositViewSet(viewsets.ModelViewSet):
    serializer_class = DepositSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Get deposits for subscriptions of businesses owned by current user
        queryset = Deposit.objects.filter(
            subscription__business__owner=self.request.user
        )
        business_id = self.request.query_params.get('business')
        if business_id:
            queryset = queryset.filter(subscription__business_id=business_id)
        else:
            first_subscription = Subscription.objects.filter(
                business__owner=self.request.user
            ).order_by('id').first()
            if first_subscription:
                queryset = queryset.filter(subscription=first_subscription)
        return queryset

    def _resolve_subscription(self, request):
        business_id = request.data.get('business') or request.query_params.get('business')
        subscriptions = Subscription.objects.filter(business__owner=request.user).order_by('id')
        if business_id:
            subscriptions = subscriptions.filter(business_id=business_id)
        return subscriptions.first()

    def get_serializer_class(self):
        if self.action == 'create':
            return DepositCreateSerializer
        return DepositSerializer

    def create(self, request, *args, **kwargs):
        """Create a new deposit request"""
        subscription = self._resolve_subscription(request)
        if not subscription:
            return Response(
                {'detail': 'No subscription found'},
                status=status.HTTP_404_NOT_FOUND
            )

        serializer = self.get_serializer(
            data=request.data,
            context={'subscription': subscription}
        )
        serializer.is_valid(raise_exception=True)
        deposit = serializer.save()

        return Response(
            DepositSerializer(deposit).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Complete a deposit and add credits to account"""
        deposit = self.get_object()
        
        if deposit.status != DepositStatus.PENDING:
            return Response(
                {'detail': f'Cannot complete deposit with status {deposit.status}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if deposit.complete_deposit():
            return Response(
                DepositSerializer(deposit).data,
                status=status.HTTP_200_OK
            )
        
        return Response(
            {'detail': 'Failed to complete deposit'},
            status=status.HTTP_400_BAD_REQUEST
        )

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Cancel a pending deposit"""
        deposit = self.get_object()
        
        if deposit.cancel_deposit():
            return Response(
                DepositSerializer(deposit).data,
                status=status.HTTP_200_OK
            )
        
        return Response(
            {'detail': 'Cannot cancel deposit with current status'},
            status=status.HTTP_400_BAD_REQUEST
        )

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Get deposit summary for current user"""
        subscription = self._resolve_subscription(request)
        if not subscription:
            return Response(
                {'detail': 'No subscription found'},
                status=status.HTTP_404_NOT_FOUND
            )

        deposits = self.get_queryset().filter(subscription=subscription)
        
        summary = {
            'total_deposited': sum(d.amount for d in deposits.filter(status=DepositStatus.COMPLETED)),
            'pending_deposits': sum(d.amount for d in deposits.filter(status=DepositStatus.PENDING)),
            'failed_deposits': sum(d.amount for d in deposits.filter(status=DepositStatus.FAILED)),
            'current_balance': subscription.account_balance,
            'total_spent': subscription.total_spent,
            'recent_deposits': DepositSerializer(
                deposits[:10],
                many=True
            ).data
        }
        
        return Response(summary)


class SubscriptionFeatureViewSet(viewsets.ModelViewSet):
    serializer_class = SubscriptionFeatureSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Get subscription features for subscriptions of businesses owned by current user
        queryset = SubscriptionFeature.objects.filter(
            subscription__business__owner=self.request.user
        )
        business_id = self.request.query_params.get('business')
        if business_id:
            queryset = queryset.filter(subscription__business_id=business_id)
        else:
            first_subscription = Subscription.objects.filter(
                business__owner=self.request.user
            ).order_by('id').first()
            if first_subscription:
                queryset = queryset.filter(subscription=first_subscription)
        return queryset

    def _resolve_subscription(self, request):
        business_id = request.data.get('business') or request.query_params.get('business')
        subscriptions = Subscription.objects.filter(business__owner=request.user).order_by('id')
        if business_id:
            subscriptions = subscriptions.filter(business_id=business_id)
        return subscriptions.first()

    def list(self, request, *args, **kwargs):
        subscription = self._resolve_subscription(request)
        if subscription:
            # Best effort; don't fail GET due to SQLite write-lock races.
            try:
                subscription.sync_feature_assignments_from_flags()
            except OperationalError as exc:
                logger.warning("Skipping subscription feature sync on list(): %s", exc)
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        """Create a new subscription feature"""
        subscription = self._resolve_subscription(request)
        if not subscription:
            return Response(
                {'detail': 'No subscription found'},
                status=status.HTTP_404_NOT_FOUND
            )

        serializer = self.get_serializer(
            data=request.data,
            context={'subscription': subscription}
        )
        serializer.is_valid(raise_exception=True)
        feature = serializer.save()

        # Enable the corresponding field on the subscription model
        feature_name = feature.feature.feature
        field_name = f'enable_{feature_name}'
        
        if hasattr(subscription, field_name):
            setattr(subscription, field_name, True)
            subscription.save(update_fields=[field_name, 'updated_at'])
            print(f"[SUBSCRIPTION_FEATURE] Enabled {field_name} on subscription")
        else:
            print(f"[SUBSCRIPTION_FEATURE] Warning: Field {field_name} not found on Subscription model")

        return Response(
            SubscriptionFeatureSerializer(feature).data,
            status=status.HTTP_201_CREATED
        )

    def destroy(self, request, *args, **kwargs):
        """Delete a subscription feature"""
        try:
            instance = self.get_object()
            
            # Disable the corresponding field on the subscription model
            subscription = instance.subscription
            feature_name = instance.feature.feature
            field_name = f'enable_{feature_name}'
            
            if hasattr(subscription, field_name):
                setattr(subscription, field_name, False)
                subscription.save(update_fields=[field_name, 'updated_at'])
                print(f"[SUBSCRIPTION_FEATURE] Disabled {field_name} on subscription")
            else:
                print(f"[SUBSCRIPTION_FEATURE] Warning: Field {field_name} not found on Subscription model")
            
            self.perform_destroy(instance)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response(
                {'detail': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=['post'])
    def toggle_feature(self, request):
        """Toggle a feature on/off for the subscription"""
        subscription = self._resolve_subscription(request)
        if not subscription:
            return Response(
                {'detail': 'No subscription found'},
                status=status.HTTP_404_NOT_FOUND
            )

        feature_id = request.data.get('feature')
        enabled = request.data.get('enabled', True)

        if not feature_id:
            return Response(
                {'detail': 'feature ID is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            feature = FeaturePricing.objects.get(id=feature_id)
        except FeaturePricing.DoesNotExist:
            return Response(
                {'detail': 'Feature not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        if enabled:
            # Create or update subscription feature
            sub_feature, created = SubscriptionFeature.objects.get_or_create(
                subscription=subscription,
                feature=feature,
                defaults={'enabled': True}
            )
            if not created:
                sub_feature.enabled = True
                sub_feature.save()
            field_name = f'enable_{feature.feature}'
            if hasattr(subscription, field_name):
                setattr(subscription, field_name, True)
                subscription.save(update_fields=[field_name, 'updated_at'])
        else:
            # Delete subscription feature
            SubscriptionFeature.objects.filter(
                subscription=subscription,
                feature=feature
            ).delete()
            field_name = f'enable_{feature.feature}'
            if hasattr(subscription, field_name):
                setattr(subscription, field_name, False)
                subscription.save(update_fields=[field_name, 'updated_at'])

        # Return updated subscription
        return Response(
            SubscriptionSerializer(subscription).data,
            status=status.HTTP_200_OK
        )


class FeaturePricingViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for feature pricing.
    Returns all features for frontend to display and manage.
    """
    queryset = FeaturePricing.objects.all().order_by('feature')
    serializer_class = FeaturePricingSerializer
    permission_classes = [permissions.AllowAny]
    pagination_class = None  # Disable pagination to return all features at once
    filterset_fields = ['is_active']
    search_fields = ['feature', 'description']

    @action(detail=False, methods=['get'])
    def all_features(self, request):
        """Get all feature pricing"""
        features = FeaturePricing.objects.all().order_by('feature')
        serializer = self.get_serializer(features, many=True)
        return Response(serializer.data)

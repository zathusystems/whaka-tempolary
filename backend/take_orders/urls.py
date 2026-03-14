from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TakeOrderViewSet, self_service_order
from .sync_views import sync_push, sync_pull

router = DefaultRouter()
router.register(r'take-orders', TakeOrderViewSet, basename='take-order')

urlpatterns = [
    path('self-service/', self_service_order, name='self-service-order'),
    path('sync/push/', sync_push, name='take-order-sync-push'),
    path('sync/pull/', sync_pull, name='take-order-sync-pull'),
    path('', include(router.urls)),
]

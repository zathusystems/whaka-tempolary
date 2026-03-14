from django.contrib import admin
from .models import Business, Branch, BusinessSettings, TaxRate, Expense

@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'tin', 'business_type', 'owner', 'is_active', 'created_at')
    search_fields = ('name', 'tin', 'owner__email')
    list_filter = ('business_type', 'is_active', 'created_at')
    ordering = ('-created_at',)

@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'business', 'city', 'country', 'is_active', 'created_at')
    search_fields = ('name', 'business__name', 'city')
    list_filter = ('is_active', 'country', 'created_at')
    ordering = ('-created_at',)

@admin.register(TaxRate)
class TaxRateAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'rate', 'business', 'is_default', 'created_at')
    search_fields = ('name', 'business__name')
    list_filter = ('is_default', 'created_at')
    ordering = ('-is_default', '-created_at')

@admin.register(BusinessSettings)
class BusinessSettingsAdmin(admin.ModelAdmin):
    list_display = ('id', 'business', 'currency', 'timezone')
    search_fields = ('business__name',)
    list_filter = ('currency', 'timezone')

@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'business', 'branch', 'category', 'amount', 'status', 'created_by', 'created_at')
    search_fields = ('title', 'business__name', 'category', 'created_by')
    list_filter = ('status', 'category', 'created_at', 'business')
    readonly_fields = ('id', 'created_at', 'approved_at')
    fieldsets = (
        ('Basic Information', {
            'fields': ('id', 'title', 'category', 'amount', 'date', 'notes')
        }),
        ('Business & Branch', {
            'fields': ('business', 'branch')
        }),
        ('Status & Approval', {
            'fields': ('status', 'created_by', 'created_at', 'approved_by', 'approved_at')
        }),
        ('Sync Tracking', {
            'fields': ('is_dirty',),
            'classes': ('collapse',)
        }),
    )
    ordering = ('-created_at',)

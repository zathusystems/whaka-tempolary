# Standalone Cloud Sync Service

Centralized, independent sync manager for all system operations across all apps.

## Location

**Standalone files** (not tied to any app):
- `/backend/sync_service.py` - Main sync manager
- `/backend/sync_views.py` - API endpoints
- `/backend/core/management/commands/sync_cloud.py` - CLI command

## How to Use

### 1. Via Management Command

```bash
# Sync all dirty records
python manage.py sync_cloud

# Check sync status without syncing
python manage.py sync_cloud --status

# Custom cloud URL
python manage.py sync_cloud --cloud-url http://custom-cloud.com:8001
```

### 2. Via API Endpoints

```bash
# Sync all dirty records
curl -X POST http://localhost:8000/api/sync-to-cloud/ \
  -H "Authorization: Bearer <token>"

# Check sync status
curl http://localhost:8000/api/sync-status/ \
  -H "Authorization: Bearer <token>"
```

### 3. Programmatically

```python
from sync_service import sync_all_to_cloud, get_sync_status

# Sync everything
results = sync_all_to_cloud()
print(f"Synced: {results['total_synced']}, Failed: {results['total_failed']}")

# Check status
status = get_sync_status()
print(f"Total dirty records: {status['total_dirty']}")
```

## What It Syncs

Automatically handles all models from all apps:

**Business App:**
- Business, Branch, TaxRate, BusinessSettings
- Customer, InvoiceLine, Invoice, Expense

**Inventory App:**
- Product, Stock, Supplier, Purchase, PurchaseRecord, Waste

**Staff App:**
- Staff

**Subscription App:**
- Subscription

## Configuration

Set in `settings.py`:

```python
CLOUD_BACKEND_URL = os.getenv('CLOUD_BACKEND_URL', 'http://localhost:8001')
```

Or via environment variable:

```bash
export CLOUD_BACKEND_URL=http://cloud.example.com:8001
```

## Sync Report

Returns comprehensive report:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "cloud_url": "http://localhost:8001",
  "total_models": 8,
  "total_records": 25,
  "total_synced": 24,
  "total_failed": 1,
  "models": {
    "Invoice": {
      "total": 10,
      "synced": 10,
      "failed": 0,
      "records": [...]
    }
  }
}
```

## Architecture

```
sync_service.py (CloudSyncManager)
    ├── Registers all models from all apps
    ├── Finds all dirty records
    ├── Serializes records
    ├── Sends to cloud backend
    └── Marks as synced

sync_views.py (API endpoints)
    ├── /api/sync-to-cloud/ (POST)
    └── /api/sync-status/ (GET)

core/management/commands/sync_cloud.py (CLI)
    └── python manage.py sync_cloud
```

## Single Point of Sync

All system operations sync through this one centralized service:
- Not tied to any app
- Easy to manage and maintain
- Can be used from anywhere in the project
- Handles all models automatically

## Features

✅ Centralized sync for all apps
✅ Automatic model registration
✅ Comprehensive error handling
✅ Detailed sync reports
✅ CLI and API access
✅ Programmatic access
✅ Status checking
✅ Logging

Done!

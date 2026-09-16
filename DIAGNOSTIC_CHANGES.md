# MongoDB Diagnostic Changes

## Summary
Temporary diagnostic endpoint added to expose MongoDB connection errors safely for debugging deployment issues.

## Files Modified

### 1. src/config/env.js
- Added `MONGODB_DIAGNOSTIC` environment variable (default: "false")
- Type: string, checked as "true" to enable

### 2. src/config/db.js
- Added `lastError` field to `mongoCache` object
- Modified `attachConnectionListeners()` to capture error details:
  - Stores: `{ message, code, name }`
  - Does NOT store: connection string, credentials, passwords
- Modified `trackConnection()` to capture initial connection errors
- Added `getMongoDBError()` export function
  - Returns last stored error or null
  - Returns only safe, non-sensitive fields

### 3. src/routes/index.js
- Added imports: `env`, `getMongoDBError`
- Added new endpoint: `GET /api/health/db-diagnostic`
  - Returns 404 if `MONGODB_DIAGNOSTIC !== "true"`
  - Returns connection error details if available
  - Includes: message, code, type (error name)
  - Does NOT include: stack trace, connection string, credentials

## What Is NOT Exposed

- MONGODB_URI
- Database username
- Database password
- Connection string query parameters
- Stack traces
- Vercel system details
- Internal error objects

## How to Enable

### On Vercel:
1. Go to Project Settings → Environment Variables
2. Add: `MONGODB_DIAGNOSTIC = true`
3. Redeploy

### Locally:
Set in `.env` file:
```
MONGODB_DIAGNOSTIC=true
```

## Endpoint

```
GET https://maaadagency-server.vercel.app/api/health/db-diagnostic
```

## Response Format

When enabled and database is disconnected:
```json
{
  "success": false,
  "data": {
    "status": "degraded",
    "database": "disconnected",
    "uptime": 45,
    "timestamp": "2026-09-16T...",
    "connectionError": {
      "message": "querySrv ENOTFOUND alphadb.2b0exmo.mongodb.net",
      "code": "ENOTFOUND",
      "type": "MongooseServerSelectionError"
    }
  }
}
```

## When to Remove

This is a TEMPORARY diagnostic. Remove after:
1. Identifying the MongoDB connection issue
2. Fixing the issue
3. Verifying connectivity is restored

Remove by:
1. Deleting the `MONGODB_DIAGNOSTIC` line from env.js
2. Deleting the `/health/db-diagnostic` endpoint from routes/index.js
3. Removing `lastError` from mongoCache in db.js
4. Removing error storage code from listeners and trackConnection

## Testing

✓ Syntax validation passed
✓ Imports work correctly
✓ Environment configuration valid
✓ All files modified as specified

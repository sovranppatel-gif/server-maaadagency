# MongoDB Active Connection Diagnostic

## Implementation Status
✓ Diagnostic endpoint now actively attempts MongoDB connection
✓ Captures real connection errors
✓ No secrets exposed

## How It Works

The `/api/health/db-diagnostic` endpoint:
1. Checks if `MONGODB_DIAGNOSTIC === "true"`
2. Returns 404 if disabled (security)
3. Calls `await connectDB()` to attempt actual connection
4. If connection succeeds → returns success response
5. If connection fails → catches error and returns error details

## Endpoint

```
GET https://maaadagency-server.vercel.app/api/health/db-diagnostic
```

## Enable on Vercel

Vercel Dashboard → Project → Settings → Environment Variables

Add:
```
MONGODB_DIAGNOSTIC = true
```

Then redeploy.

## Expected Responses

### Success Response (MongoDB Connected)
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "database": "connected",
    "uptime": 45,
    "timestamp": "2026-09-16T..."
  }
}
```

### Failure Response (MongoDB Connection Error)
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

Common error messages:
- `querySrv ENOTFOUND` → DNS lookup failed
- `authentication failed` → Wrong credentials
- `ECONNREFUSED` → Server refused connection
- `ETIMEDOUT` → Connection timeout
- `CERT` → SSL/TLS certificate issue

## What's NOT Exposed

✓ MONGODB_URI
✓ Username/Password
✓ Connection string
✓ Stack traces
✓ JWT secrets
✓ WhatsApp tokens

## Files Modified

1. **src/config/env.js**
   - Added MONGODB_DIAGNOSTIC variable

2. **src/config/db.js**
   - Added lastError to mongoCache
   - Added getMongoDBError() export
   - Error capture in listeners

3. **src/routes/index.js**
   - Added connectDB import
   - Made diagnostic endpoint async
   - Added try-catch for active connection attempt

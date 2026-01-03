# Garmin Historical Data Sync - Design Document

**Date:** 2026-01-03
**Status:** Approved

## Overview

Enhance the Garmin integration to support multi-year historical data sync with background processing, progress tracking, and resume capability.

## Current State

- Frontend sync button hardcoded to 7 days (`ExternalProviderSettings.tsx:367-372`)
- Backend validates max 365 days (`garminRoutes.js:17`)
- No progress tracking or background processing
- No incremental sync (always re-fetches entire range)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Historical range limit | Unlimited | Users control their own data |
| Long sync handling | Background job with polling | User can navigate away, robust |
| Chunk size | 30 days | Balance of speed and reliability |
| Default sync behavior | Incremental (since last sync) | Fast for daily use |
| Override option | Separate "Historical Import" button | Clear intent separation |
| Progress display | Inline on provider card | Contextual, simple |
| Failure handling | Resume from last successful chunk | Don't lose progress on hiccups |

## Architecture

```
Frontend                         Backend                          Microservice
────────                         ───────                          ────────────
ExternalProviderSettings    →    garminRoutes.js             →    Python Garmin
├── "Sync" (incremental)         ├── POST /sync/incremental       (unchanged)
├── "Historical Import"          ├── POST /sync/historical
├── Progress bar                 ├── GET /sync/status
└── Poll every 3s                └── garminSyncJobService.js
                                      └── garmin_sync_jobs table
```

## Database Schema

### New table: `garmin_sync_jobs`

```sql
CREATE TABLE garmin_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Job configuration
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  sync_type VARCHAR(20) NOT NULL,  -- 'incremental' | 'historical'
  metric_types TEXT[],

  -- Progress tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | running | paused | completed | failed
  current_chunk_start DATE,
  current_chunk_end DATE,
  chunks_completed INTEGER DEFAULT 0,
  chunks_total INTEGER,
  last_successful_date DATE,

  -- Timing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Error handling
  error_message TEXT,
  failed_chunks JSONB DEFAULT '[]',

  CONSTRAINT valid_status CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed')),
  CONSTRAINT valid_sync_type CHECK (sync_type IN ('incremental', 'historical'))
);

CREATE INDEX idx_garmin_sync_jobs_user_status ON garmin_sync_jobs(user_id, status);
CREATE INDEX idx_garmin_sync_jobs_user_created ON garmin_sync_jobs(user_id, created_at DESC);
```

### Modify `external_data_providers`

```sql
ALTER TABLE external_data_providers
  ADD COLUMN last_successful_sync_date DATE;
```

## API Endpoints

### POST /integrations/garmin/sync/incremental

Start incremental sync from last successful sync date to today.

**Request:**
```json
{
  "metricTypes": ["steps", "sleep", "stress"]  // optional, null = all
}
```

**Response:**
```json
{
  "jobId": "uuid",
  "status": "started",
  "message": "Syncing from 2025-12-01 to 2026-01-03"
}
```

### POST /integrations/garmin/sync/historical

Start historical sync for a custom date range.

**Request:**
```json
{
  "startDate": "2020-01-01",
  "endDate": "2026-01-03",
  "metricTypes": null
}
```

**Response:**
```json
{
  "jobId": "uuid",
  "status": "started",
  "chunksTotal": 73,
  "estimatedMinutes": 15
}
```

### GET /integrations/garmin/sync/status

Get current sync job status (for polling).

**Response (active job):**
```json
{
  "hasActiveJob": true,
  "job": {
    "id": "uuid",
    "status": "running",
    "syncType": "historical",
    "startDate": "2020-01-01",
    "endDate": "2026-01-03",
    "chunksCompleted": 33,
    "chunksTotal": 73,
    "percentComplete": 45,
    "currentChunkRange": "Jan 2022 - Feb 2022",
    "errorMessage": null
  },
  "lastSuccessfulSync": "2025-12-28T14:30:00Z"
}
```

**Response (no active job):**
```json
{
  "hasActiveJob": false,
  "job": null,
  "lastSuccessfulSync": "2026-01-03T10:15:00Z"
}
```

### POST /integrations/garmin/sync/resume

Resume a paused or failed job.

**Request:**
```json
{
  "jobId": "uuid"
}
```

### POST /integrations/garmin/sync/cancel

Cancel an active job.

**Request:**
```json
{
  "jobId": "uuid"
}
```

## Backend Implementation

### New file: `garminSyncJobService.js`

```javascript
// Core functions
async function startIncrementalSync(userId, metricTypes = null)
async function startHistoricalSync(userId, startDate, endDate, metricTypes = null)
async function getJobStatus(userId)
async function resumeJob(userId, jobId)
async function cancelJob(userId, jobId)

// Internal processing
async function processJob(jobId)
async function processNextChunk(job)
function calculateChunks(startDate, endDate, chunkSizeDays = 30)
```

### Job Processing Flow

1. Create job record with status='pending'
2. Calculate total chunks (date range / 30 days)
3. Set status='running', started_at=now()
4. For each chunk:
   - Update current_chunk_start/end
   - Call existing sync functions
   - Update chunks_completed, last_successful_date
   - Use setImmediate() to yield to event loop
5. On completion: status='completed', update last_successful_sync_date
6. On error: log to failed_chunks, continue to next chunk
7. If all chunks fail: status='failed'

### Remove 365-day limit

In `garminRoutes.js`, remove or significantly increase MAX_DATE_RANGE_DAYS:

```javascript
// Remove this line:
// const MAX_DATE_RANGE_DAYS = 365;

// Or increase to 10 years if you want some limit:
const MAX_DATE_RANGE_DAYS = 3650;
```

## Frontend Implementation

### ExternalProviderSettings.tsx Changes

1. **Replace `handleManualSyncGarmin`:**
   - Call `/sync/incremental` instead of hardcoded 7-day range
   - Start polling on success

2. **Add Historical Import button:**
   - Opens dialog with date range picker
   - Calls `/sync/historical`
   - Starts polling on success

3. **Add polling hook:**
   ```typescript
   const [syncStatus, setSyncStatus] = useState(null);

   useEffect(() => {
     if (!syncStatus?.hasActiveJob) return;
     const interval = setInterval(pollStatus, 3000);
     return () => clearInterval(interval);
   }, [syncStatus?.hasActiveJob]);
   ```

4. **Add inline progress display:**
   - Progress bar component
   - Status text: "Syncing... 45% (Processing Jan-Feb 2022)"
   - Resume/Cancel buttons when applicable

### New component: GarminSyncProgress.tsx

```typescript
interface GarminSyncProgressProps {
  job: SyncJob;
  onResume: () => void;
  onCancel: () => void;
}
```

Displays:
- Progress bar with percentage
- Current chunk being processed
- Elapsed time
- Resume button (if paused/failed)
- Cancel button (if running)

### New component: HistoricalImportDialog.tsx

```typescript
interface HistoricalImportDialogProps {
  open: boolean;
  onClose: () => void;
  onStart: (startDate: string, endDate: string) => void;
}
```

Features:
- Date range picker (start/end)
- Preset buttons: "Last year", "Last 5 years", "All time"
- Estimated time display based on date range
- Start button

## File Changes Summary

| File | Change |
|------|--------|
| `SparkyFitnessServer/db/migrations/YYYYMMDD_garmin_sync_jobs.sql` | New migration |
| `SparkyFitnessServer/models/garminSyncJobRepository.js` | New file |
| `SparkyFitnessServer/services/garminSyncJobService.js` | New file |
| `SparkyFitnessServer/routes/garminRoutes.js` | Add new endpoints, remove 365-day limit |
| `SparkyFitnessFrontend/src/components/ExternalProviderSettings.tsx` | Add polling, progress display |
| `SparkyFitnessFrontend/src/components/GarminSyncProgress.tsx` | New component |
| `SparkyFitnessFrontend/src/components/HistoricalImportDialog.tsx` | New component |
| `SparkyFitnessFrontend/src/services/garminService.ts` | New API functions |

## Testing Strategy

1. **Unit tests:**
   - Chunk calculation logic
   - Job state transitions
   - Resume from various failure points

2. **Integration tests:**
   - Full sync flow with mock Garmin API
   - Polling behavior
   - Error recovery

3. **Manual testing:**
   - Small date range (1 week)
   - Medium range (6 months)
   - Large range (multi-year) with simulated interruption

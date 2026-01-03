# Garmin Historical Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable multi-year historical Garmin data sync with background processing, progress tracking, and resume capability.

**Architecture:** Background job system with polling. Jobs are stored in PostgreSQL, processed in chunks of 30 days using setImmediate() for non-blocking execution. Frontend polls for status every 3 seconds.

**Tech Stack:** Node.js/Express backend, React frontend with shadcn/ui, PostgreSQL with RLS.

---

## Task 1: Database Migration

**Files:**
- Create: `SparkyFitnessServer/db/migrations/20260103000000_create_garmin_sync_jobs.sql`

**Step 1: Create the migration file**

```sql
-- Create garmin_sync_jobs table for tracking background sync jobs
CREATE TABLE IF NOT EXISTS garmin_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Job configuration
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  sync_type VARCHAR(20) NOT NULL,
  metric_types TEXT[],

  -- Progress tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
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

  CONSTRAINT valid_status CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  CONSTRAINT valid_sync_type CHECK (sync_type IN ('incremental', 'historical'))
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_garmin_sync_jobs_user_status ON garmin_sync_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_garmin_sync_jobs_user_created ON garmin_sync_jobs(user_id, created_at DESC);

-- RLS policies
ALTER TABLE garmin_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sync jobs"
  ON garmin_sync_jobs FOR SELECT
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY "Users can insert their own sync jobs"
  ON garmin_sync_jobs FOR INSERT
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY "Users can update their own sync jobs"
  ON garmin_sync_jobs FOR UPDATE
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY "Users can delete their own sync jobs"
  ON garmin_sync_jobs FOR DELETE
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- Add last_successful_sync_date to external_data_providers
ALTER TABLE external_data_providers
  ADD COLUMN IF NOT EXISTS last_successful_sync_date DATE;
```

**Step 2: Verify migration applies**

Run: `npm run start` (in SparkyFitnessServer - auto-migrations run on startup)

Expected: No errors, table created successfully.

---

## Task 2: Garmin Sync Job Repository

**Files:**
- Create: `SparkyFitnessServer/models/garminSyncJobRepository.js`

**Step 1: Create the repository file**

```javascript
const { getClient } = require('../db/poolManager');
const { log } = require('../config/logging');

/**
 * Create a new sync job
 */
async function createJob(userId, jobData) {
  const client = await getClient(userId);
  try {
    const {
      start_date,
      end_date,
      sync_type,
      metric_types,
      chunks_total
    } = jobData;

    const result = await client.query(
      `INSERT INTO garmin_sync_jobs
       (user_id, start_date, end_date, sync_type, metric_types, chunks_total, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [userId, start_date, end_date, sync_type, metric_types, chunks_total]
    );

    log('info', `Created Garmin sync job ${result.rows[0].id} for user ${userId}`);
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get active job for user (pending or running)
 */
async function getActiveJob(userId) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT * FROM garmin_sync_jobs
       WHERE user_id = $1 AND status IN ('pending', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Get job by ID
 */
async function getJobById(userId, jobId) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT * FROM garmin_sync_jobs WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Get most recent job for user (any status)
 */
async function getMostRecentJob(userId) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT * FROM garmin_sync_jobs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Update job status
 */
async function updateJobStatus(userId, jobId, status, additionalFields = {}) {
  const client = await getClient(userId);
  try {
    const updates = ['status = $3', 'updated_at = NOW()'];
    const values = [jobId, userId, status];
    let paramIndex = 4;

    if (status === 'running' && !additionalFields.started_at) {
      updates.push(`started_at = NOW()`);
    }

    if (status === 'completed' || status === 'failed') {
      updates.push(`completed_at = NOW()`);
    }

    for (const [key, value] of Object.entries(additionalFields)) {
      updates.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    const result = await client.query(
      `UPDATE garmin_sync_jobs SET ${updates.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      values
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Update job progress after processing a chunk
 */
async function updateJobProgress(userId, jobId, progressData) {
  const client = await getClient(userId);
  try {
    const {
      current_chunk_start,
      current_chunk_end,
      chunks_completed,
      last_successful_date
    } = progressData;

    const result = await client.query(
      `UPDATE garmin_sync_jobs SET
         current_chunk_start = $3,
         current_chunk_end = $4,
         chunks_completed = $5,
         last_successful_date = $6,
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [jobId, userId, current_chunk_start, current_chunk_end, chunks_completed, last_successful_date]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Add a failed chunk to the job
 */
async function addFailedChunk(userId, jobId, chunkData) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `UPDATE garmin_sync_jobs SET
         failed_chunks = failed_chunks || $3::jsonb,
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [jobId, userId, JSON.stringify([chunkData])]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get jobs that need to be resumed (paused or running but stale)
 */
async function getResumableJobs(userId) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT * FROM garmin_sync_jobs
       WHERE user_id = $1
       AND status IN ('paused', 'running')
       AND updated_at < NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

module.exports = {
  createJob,
  getActiveJob,
  getJobById,
  getMostRecentJob,
  updateJobStatus,
  updateJobProgress,
  addFailedChunk,
  getResumableJobs
};
```

**Step 2: Verify file syntax**

Run: `node -c SparkyFitnessServer/models/garminSyncJobRepository.js`

Expected: No syntax errors.

---

## Task 3: Garmin Sync Job Service

**Files:**
- Create: `SparkyFitnessServer/services/garminSyncJobService.js`

**Step 1: Create the service file**

```javascript
const garminSyncJobRepository = require('../models/garminSyncJobRepository');
const garminConnectService = require('../integrations/garminconnect/garminConnectService');
const garminService = require('./garminService');
const externalProviderRepository = require('../models/externalProviderRepository');
const { log } = require('../config/logging');
const moment = require('moment');

const CHUNK_SIZE_DAYS = 30;

// Track active job processing to prevent duplicates
const activeProcessing = new Map();

/**
 * Calculate chunks for a date range
 */
function calculateChunks(startDate, endDate, chunkSizeDays = CHUNK_SIZE_DAYS) {
  const chunks = [];
  let currentStart = moment(startDate);
  const end = moment(endDate);

  while (currentStart.isSameOrBefore(end)) {
    const chunkEnd = moment.min(
      moment(currentStart).add(chunkSizeDays - 1, 'days'),
      end
    );
    chunks.push({
      start: currentStart.format('YYYY-MM-DD'),
      end: chunkEnd.format('YYYY-MM-DD')
    });
    currentStart = chunkEnd.add(1, 'day');
  }

  return chunks;
}

/**
 * Start an incremental sync (from last successful sync to today)
 */
async function startIncrementalSync(userId, metricTypes = null) {
  // Check for existing active job
  const activeJob = await garminSyncJobRepository.getActiveJob(userId);
  if (activeJob) {
    return {
      status: 'already_running',
      jobId: activeJob.id,
      message: 'A sync job is already in progress'
    };
  }

  // Get last successful sync date from provider
  const provider = await externalProviderRepository.getGarminProvider(userId);
  if (!provider) {
    throw new Error('Garmin not connected. Please link your Garmin account first.');
  }

  const endDate = moment().format('YYYY-MM-DD');
  let startDate;

  if (provider.last_successful_sync_date) {
    // Start from day after last sync
    startDate = moment(provider.last_successful_sync_date).add(1, 'day').format('YYYY-MM-DD');
  } else {
    // No previous sync, default to last 7 days
    startDate = moment().subtract(7, 'days').format('YYYY-MM-DD');
  }

  // If start is after end, nothing to sync
  if (moment(startDate).isAfter(moment(endDate))) {
    return {
      status: 'up_to_date',
      message: 'Already synced up to today'
    };
  }

  const chunks = calculateChunks(startDate, endDate);

  const job = await garminSyncJobRepository.createJob(userId, {
    start_date: startDate,
    end_date: endDate,
    sync_type: 'incremental',
    metric_types: metricTypes,
    chunks_total: chunks.length
  });

  // Start processing in background
  setImmediate(() => processJob(userId, job.id));

  return {
    status: 'started',
    jobId: job.id,
    message: `Syncing from ${startDate} to ${endDate}`,
    chunksTotal: chunks.length
  };
}

/**
 * Start a historical sync with custom date range
 */
async function startHistoricalSync(userId, startDate, endDate, metricTypes = null) {
  // Validate dates
  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required');
  }

  const start = moment(startDate);
  const end = moment(endDate);

  if (!start.isValid() || !end.isValid()) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }

  if (start.isAfter(end)) {
    throw new Error('startDate must be before endDate');
  }

  if (end.isAfter(moment())) {
    throw new Error('endDate cannot be in the future');
  }

  // Check for existing active job
  const activeJob = await garminSyncJobRepository.getActiveJob(userId);
  if (activeJob) {
    return {
      status: 'already_running',
      jobId: activeJob.id,
      message: 'A sync job is already in progress'
    };
  }

  // Verify Garmin is connected
  const provider = await externalProviderRepository.getGarminProvider(userId);
  if (!provider) {
    throw new Error('Garmin not connected. Please link your Garmin account first.');
  }

  const chunks = calculateChunks(startDate, endDate);
  const estimatedMinutes = Math.ceil(chunks.length * 0.5); // ~30 seconds per chunk

  const job = await garminSyncJobRepository.createJob(userId, {
    start_date: startDate,
    end_date: endDate,
    sync_type: 'historical',
    metric_types: metricTypes,
    chunks_total: chunks.length
  });

  // Start processing in background
  setImmediate(() => processJob(userId, job.id));

  return {
    status: 'started',
    jobId: job.id,
    chunksTotal: chunks.length,
    estimatedMinutes,
    message: `Starting historical sync from ${startDate} to ${endDate}`
  };
}

/**
 * Get current sync status for a user
 */
async function getJobStatus(userId) {
  const activeJob = await garminSyncJobRepository.getActiveJob(userId);
  const provider = await externalProviderRepository.getGarminProvider(userId);

  if (!activeJob) {
    return {
      hasActiveJob: false,
      job: null,
      lastSuccessfulSync: provider?.last_successful_sync_date || null
    };
  }

  const percentComplete = activeJob.chunks_total > 0
    ? Math.round((activeJob.chunks_completed / activeJob.chunks_total) * 100)
    : 0;

  let currentChunkRange = null;
  if (activeJob.current_chunk_start && activeJob.current_chunk_end) {
    const startFormatted = moment(activeJob.current_chunk_start).format('MMM YYYY');
    const endFormatted = moment(activeJob.current_chunk_end).format('MMM YYYY');
    currentChunkRange = startFormatted === endFormatted ? startFormatted : `${startFormatted} - ${endFormatted}`;
  }

  return {
    hasActiveJob: true,
    job: {
      id: activeJob.id,
      status: activeJob.status,
      syncType: activeJob.sync_type,
      startDate: activeJob.start_date,
      endDate: activeJob.end_date,
      chunksCompleted: activeJob.chunks_completed,
      chunksTotal: activeJob.chunks_total,
      percentComplete,
      currentChunkRange,
      errorMessage: activeJob.error_message,
      failedChunks: activeJob.failed_chunks || [],
      createdAt: activeJob.created_at,
      startedAt: activeJob.started_at
    },
    lastSuccessfulSync: provider?.last_successful_sync_date || null
  };
}

/**
 * Resume a paused or failed job
 */
async function resumeJob(userId, jobId) {
  const job = await garminSyncJobRepository.getJobById(userId, jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status !== 'paused' && job.status !== 'failed') {
    throw new Error(`Cannot resume job with status: ${job.status}`);
  }

  await garminSyncJobRepository.updateJobStatus(userId, jobId, 'running');

  // Start processing in background
  setImmediate(() => processJob(userId, jobId));

  return {
    status: 'resumed',
    jobId
  };
}

/**
 * Cancel an active job
 */
async function cancelJob(userId, jobId) {
  const job = await garminSyncJobRepository.getJobById(userId, jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status !== 'pending' && job.status !== 'running' && job.status !== 'paused') {
    throw new Error(`Cannot cancel job with status: ${job.status}`);
  }

  // Stop processing if active
  activeProcessing.delete(jobId);

  await garminSyncJobRepository.updateJobStatus(userId, jobId, 'cancelled');

  return {
    status: 'cancelled',
    jobId
  };
}

/**
 * Process a sync job (runs in background)
 */
async function processJob(userId, jobId) {
  // Prevent duplicate processing
  if (activeProcessing.has(jobId)) {
    log('info', `Job ${jobId} is already being processed`);
    return;
  }

  activeProcessing.set(jobId, true);

  try {
    const job = await garminSyncJobRepository.getJobById(userId, jobId);
    if (!job) {
      log('error', `Job ${jobId} not found`);
      return;
    }

    if (job.status === 'cancelled' || job.status === 'completed') {
      log('info', `Job ${jobId} is ${job.status}, skipping`);
      return;
    }

    // Mark as running
    await garminSyncJobRepository.updateJobStatus(userId, jobId, 'running');

    // Calculate remaining chunks
    const allChunks = calculateChunks(job.start_date, job.end_date);
    const startFromDate = job.last_successful_date
      ? moment(job.last_successful_date).add(1, 'day')
      : moment(job.start_date);

    const remainingChunks = allChunks.filter(chunk =>
      moment(chunk.start).isSameOrAfter(startFromDate)
    );

    log('info', `Processing job ${jobId}: ${remainingChunks.length} chunks remaining`);

    for (let i = 0; i < remainingChunks.length; i++) {
      // Check if cancelled
      if (!activeProcessing.has(jobId)) {
        log('info', `Job ${jobId} was cancelled, stopping`);
        return;
      }

      const chunk = remainingChunks[i];

      try {
        // Update current chunk
        await garminSyncJobRepository.updateJobProgress(userId, jobId, {
          current_chunk_start: chunk.start,
          current_chunk_end: chunk.end,
          chunks_completed: job.chunks_completed + i,
          last_successful_date: job.last_successful_date
        });

        // Sync this chunk
        log('info', `Job ${jobId}: Processing chunk ${chunk.start} to ${chunk.end}`);

        // Fetch health and wellness data
        const healthData = await garminConnectService.syncGarminHealthAndWellness(
          userId,
          chunk.start,
          chunk.end,
          job.metric_types
        );

        // Process the data
        if (healthData && healthData.data) {
          await garminService.processGarminHealthAndWellnessData(
            userId,
            userId,
            healthData.data,
            chunk.start,
            chunk.end
          );

          // Process sleep data if present
          if (healthData.data.sleep && healthData.data.sleep.length > 0) {
            await garminService.processGarminSleepData(
              userId,
              userId,
              healthData.data.sleep,
              chunk.start,
              chunk.end
            );
          }
        }

        // Fetch activities
        const activityData = await garminConnectService.fetchGarminActivitiesAndWorkouts(
          userId,
          chunk.start,
          chunk.end,
          null
        );

        if (activityData) {
          await garminService.processActivitiesAndWorkouts(
            userId,
            activityData,
            chunk.start,
            chunk.end
          );
        }

        // Update progress
        await garminSyncJobRepository.updateJobProgress(userId, jobId, {
          current_chunk_start: chunk.start,
          current_chunk_end: chunk.end,
          chunks_completed: job.chunks_completed + i + 1,
          last_successful_date: chunk.end
        });

        log('info', `Job ${jobId}: Completed chunk ${chunk.start} to ${chunk.end}`);

      } catch (chunkError) {
        log('error', `Job ${jobId}: Error processing chunk ${chunk.start} to ${chunk.end}:`, chunkError);

        // Record failed chunk but continue
        await garminSyncJobRepository.addFailedChunk(userId, jobId, {
          start: chunk.start,
          end: chunk.end,
          error: chunkError.message
        });
      }

      // Yield to event loop between chunks
      await new Promise(resolve => setImmediate(resolve));
    }

    // All chunks processed
    await garminSyncJobRepository.updateJobStatus(userId, jobId, 'completed');

    // Update provider's last successful sync date
    await externalProviderRepository.updateLastSyncDate(userId, 'garmin', job.end_date);

    log('info', `Job ${jobId} completed successfully`);

  } catch (error) {
    log('error', `Job ${jobId} failed:`, error);
    await garminSyncJobRepository.updateJobStatus(userId, jobId, 'failed', {
      error_message: error.message
    });
  } finally {
    activeProcessing.delete(jobId);
  }
}

module.exports = {
  calculateChunks,
  startIncrementalSync,
  startHistoricalSync,
  getJobStatus,
  resumeJob,
  cancelJob,
  processJob
};
```

**Step 2: Verify file syntax**

Run: `node -c SparkyFitnessServer/services/garminSyncJobService.js`

Expected: No syntax errors.

---

## Task 4: Update External Provider Repository

**Files:**
- Modify: `SparkyFitnessServer/models/externalProviderRepository.js`

**Step 1: Add getGarminProvider function**

Add after the existing exports (find the module.exports section and add before it):

```javascript
/**
 * Get Garmin provider for a user
 */
async function getGarminProvider(userId) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT * FROM external_data_providers
       WHERE user_id = $1 AND provider_type = 'garmin' AND is_active = true
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Update last successful sync date for a provider
 */
async function updateLastSyncDate(userId, providerType, syncDate) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `UPDATE external_data_providers
       SET last_successful_sync_date = $3, updated_at = NOW()
       WHERE user_id = $1 AND provider_type = $2
       RETURNING *`,
      [userId, providerType, syncDate]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}
```

**Step 2: Add to module.exports**

Find the `module.exports` object and add:

```javascript
  getGarminProvider,
  updateLastSyncDate,
```

---

## Task 5: Update Garmin Routes

**Files:**
- Modify: `SparkyFitnessServer/routes/garminRoutes.js`

**Step 1: Remove 365-day limit**

Change line 17 from:
```javascript
const MAX_DATE_RANGE_DAYS = 365; // Maximum allowed date range
```

To:
```javascript
const MAX_DATE_RANGE_DAYS = 3650; // 10 years maximum for direct API calls
```

**Step 2: Add service import at top of file**

After the existing requires (around line 12):

```javascript
const garminSyncJobService = require('../services/garminSyncJobService');
```

**Step 3: Add new endpoints before module.exports**

Add before `module.exports = router;`:

```javascript
// Start incremental sync (since last successful sync)
router.post('/sync/incremental', authenticate, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { metricTypes } = req.body;

        const result = await garminSyncJobService.startIncrementalSync(userId, metricTypes);
        res.status(200).json(result);
    } catch (error) {
        log('error', `Error starting incremental sync for user ${req.userId}:`, error);
        next(error);
    }
});

// Start historical sync with custom date range
router.post('/sync/historical', authenticate, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { startDate, endDate, metricTypes } = req.body;

        const result = await garminSyncJobService.startHistoricalSync(
            userId,
            startDate,
            endDate,
            metricTypes
        );
        res.status(200).json(result);
    } catch (error) {
        log('error', `Error starting historical sync for user ${req.userId}:`, error);
        next(error);
    }
});

// Get current sync status (for polling)
router.get('/sync/status', authenticate, async (req, res, next) => {
    try {
        const userId = req.userId;
        const status = await garminSyncJobService.getJobStatus(userId);
        res.status(200).json(status);
    } catch (error) {
        log('error', `Error getting sync status for user ${req.userId}:`, error);
        next(error);
    }
});

// Resume a paused or failed job
router.post('/sync/resume', authenticate, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { jobId } = req.body;

        if (!jobId) {
            return res.status(400).json({ error: 'jobId is required' });
        }

        const result = await garminSyncJobService.resumeJob(userId, jobId);
        res.status(200).json(result);
    } catch (error) {
        log('error', `Error resuming sync for user ${req.userId}:`, error);
        next(error);
    }
});

// Cancel an active job
router.post('/sync/cancel', authenticate, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { jobId } = req.body;

        if (!jobId) {
            return res.status(400).json({ error: 'jobId is required' });
        }

        const result = await garminSyncJobService.cancelJob(userId, jobId);
        res.status(200).json(result);
    } catch (error) {
        log('error', `Error cancelling sync for user ${req.userId}:`, error);
        next(error);
    }
});
```

**Step 4: Verify server starts**

Run: `cd SparkyFitnessServer && npm run start`

Expected: Server starts without errors.

---

## Task 6: Frontend - Garmin Service API

**Files:**
- Create: `SparkyFitnessFrontend/src/services/garminSyncService.ts`

**Step 1: Create the service file**

```typescript
import { apiCall } from './api';

export interface SyncJob {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  syncType: 'incremental' | 'historical';
  startDate: string;
  endDate: string;
  chunksCompleted: number;
  chunksTotal: number;
  percentComplete: number;
  currentChunkRange: string | null;
  errorMessage: string | null;
  failedChunks: Array<{ start: string; end: string; error: string }>;
  createdAt: string;
  startedAt: string | null;
}

export interface SyncStatus {
  hasActiveJob: boolean;
  job: SyncJob | null;
  lastSuccessfulSync: string | null;
}

export interface StartSyncResponse {
  status: 'started' | 'already_running' | 'up_to_date';
  jobId?: string;
  message: string;
  chunksTotal?: number;
  estimatedMinutes?: number;
}

export async function startIncrementalSync(metricTypes?: string[]): Promise<StartSyncResponse> {
  return apiCall('/integrations/garmin/sync/incremental', {
    method: 'POST',
    body: JSON.stringify({ metricTypes }),
  });
}

export async function startHistoricalSync(
  startDate: string,
  endDate: string,
  metricTypes?: string[]
): Promise<StartSyncResponse> {
  return apiCall('/integrations/garmin/sync/historical', {
    method: 'POST',
    body: JSON.stringify({ startDate, endDate, metricTypes }),
  });
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return apiCall('/integrations/garmin/sync/status', {
    method: 'GET',
  });
}

export async function resumeSync(jobId: string): Promise<{ status: string; jobId: string }> {
  return apiCall('/integrations/garmin/sync/resume', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });
}

export async function cancelSync(jobId: string): Promise<{ status: string; jobId: string }> {
  return apiCall('/integrations/garmin/sync/cancel', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });
}
```

---

## Task 7: Frontend - GarminSyncProgress Component

**Files:**
- Create: `SparkyFitnessFrontend/src/components/GarminSyncProgress.tsx`

**Step 1: Create the component**

```typescript
import React from 'react';
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, Pause, Play, X, AlertCircle, CheckCircle } from "lucide-react";
import { SyncJob } from '@/services/garminSyncService';

interface GarminSyncProgressProps {
  job: SyncJob;
  onResume: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const GarminSyncProgress: React.FC<GarminSyncProgressProps> = ({
  job,
  onResume,
  onCancel,
  loading = false
}) => {
  const getStatusIcon = () => {
    switch (job.status) {
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case 'paused':
        return <Pause className="h-4 w-4 text-yellow-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      default:
        return <Loader2 className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusText = () => {
    switch (job.status) {
      case 'pending':
        return 'Starting...';
      case 'running':
        return job.currentChunkRange
          ? `Syncing ${job.currentChunkRange}...`
          : 'Syncing...';
      case 'paused':
        return 'Paused';
      case 'failed':
        return job.errorMessage || 'Sync failed';
      case 'completed':
        return 'Sync complete';
      case 'cancelled':
        return 'Cancelled';
      default:
        return job.status;
    }
  };

  const showResumeButton = job.status === 'paused' || job.status === 'failed';
  const showCancelButton = job.status === 'running' || job.status === 'pending';

  return (
    <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="text-sm font-medium">
            {job.syncType === 'historical' ? 'Historical Import' : 'Sync'}
          </span>
        </div>
        <span className="text-sm text-muted-foreground">
          {job.percentComplete}%
        </span>
      </div>

      <Progress value={job.percentComplete} className="h-2" />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {getStatusText()}
        </span>
        <span className="text-xs text-muted-foreground">
          {job.chunksCompleted} / {job.chunksTotal} chunks
        </span>
      </div>

      {(showResumeButton || showCancelButton) && (
        <div className="flex gap-2 pt-1">
          {showResumeButton && (
            <Button
              size="sm"
              variant="outline"
              onClick={onResume}
              disabled={loading}
              className="h-7 text-xs"
            >
              <Play className="h-3 w-3 mr-1" />
              Resume
            </Button>
          )}
          {showCancelButton && (
            <Button
              size="sm"
              variant="outline"
              onClick={onCancel}
              disabled={loading}
              className="h-7 text-xs"
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      )}

      {job.failedChunks && job.failedChunks.length > 0 && (
        <div className="text-xs text-red-500 mt-1">
          {job.failedChunks.length} chunk(s) failed - will retry on resume
        </div>
      )}
    </div>
  );
};

export default GarminSyncProgress;
```

---

## Task 8: Frontend - HistoricalImportDialog Component

**Files:**
- Create: `SparkyFitnessFrontend/src/components/HistoricalImportDialog.tsx`

**Step 1: Create the component**

```typescript
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Clock } from "lucide-react";

interface HistoricalImportDialogProps {
  open: boolean;
  onClose: () => void;
  onStart: (startDate: string, endDate: string) => void;
  loading?: boolean;
}

const HistoricalImportDialog: React.FC<HistoricalImportDialogProps> = ({
  open,
  onClose,
  onStart,
  loading = false
}) => {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(today);

  const presets = [
    { label: 'Last Year', days: 365 },
    { label: 'Last 2 Years', days: 730 },
    { label: 'Last 5 Years', days: 1825 },
  ];

  const applyPreset = (days: number) => {
    const start = new Date();
    start.setDate(start.getDate() - days);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(today);
  };

  const calculateEstimate = () => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const chunks = Math.ceil(days / 30);
    const minutes = Math.ceil(chunks * 0.5);
    return { days, chunks, minutes };
  };

  const estimate = calculateEstimate();

  const handleStart = () => {
    if (startDate && endDate) {
      onStart(startDate, endDate);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Historical Import
          </DialogTitle>
          <DialogDescription>
            Import your Garmin data from a specific date range. This may take several minutes for large ranges.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.days}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(preset.days)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate || today}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                max={today}
                min={startDate}
              />
            </div>
          </div>

          {estimate && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted p-3 rounded-lg">
              <Clock className="h-4 w-4" />
              <span>
                {estimate.days} days ({estimate.chunks} chunks) -
                approximately {estimate.minutes} {estimate.minutes === 1 ? 'minute' : 'minutes'}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            disabled={!startDate || !endDate || loading}
          >
            {loading ? 'Starting...' : 'Start Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default HistoricalImportDialog;
```

---

## Task 9: Frontend - Update ExternalProviderSettings

**Files:**
- Modify: `SparkyFitnessFrontend/src/components/ExternalProviderSettings.tsx`

**Step 1: Add imports at top of file**

After existing imports:

```typescript
import GarminSyncProgress from './GarminSyncProgress';
import HistoricalImportDialog from './HistoricalImportDialog';
import {
  getSyncStatus,
  startIncrementalSync,
  startHistoricalSync,
  resumeSync,
  cancelSync,
  SyncStatus
} from '@/services/garminSyncService';
```

**Step 2: Add state variables**

After existing useState declarations (around line 43):

```typescript
const [garminSyncStatus, setGarminSyncStatus] = useState<SyncStatus | null>(null);
const [showHistoricalImport, setShowHistoricalImport] = useState(false);
const [syncLoading, setSyncLoading] = useState(false);
```

**Step 3: Add polling effect**

After the existing useEffect for loadProviders:

```typescript
// Poll for Garmin sync status
useEffect(() => {
  let interval: NodeJS.Timeout | null = null;

  const pollStatus = async () => {
    try {
      const status = await getSyncStatus();
      setGarminSyncStatus(status);

      // Stop polling if no active job
      if (!status.hasActiveJob && interval) {
        clearInterval(interval);
        interval = null;
        loadProviders(); // Refresh provider list on completion
      }
    } catch (error) {
      console.error('Error polling sync status:', error);
    }
  };

  // Initial fetch
  pollStatus();

  // Start polling if there might be an active job
  if (providers.some(p => p.provider_type === 'garmin')) {
    interval = setInterval(pollStatus, 3000);
  }

  return () => {
    if (interval) clearInterval(interval);
  };
}, [providers.length]);
```

**Step 4: Replace handleManualSyncGarmin function**

Replace the existing handleManualSyncGarmin function (around line 364):

```typescript
const handleManualSyncGarmin = async (providerId: string) => {
  setSyncLoading(true);
  try {
    const result = await startIncrementalSync();

    if (result.status === 'started') {
      toast({
        title: "Sync Started",
        description: result.message,
      });
      // Polling will pick up the new job automatically
    } else if (result.status === 'already_running') {
      toast({
        title: "Sync In Progress",
        description: "A sync is already running.",
      });
    } else if (result.status === 'up_to_date') {
      toast({
        title: "Already Synced",
        description: "Your data is already up to date.",
      });
    }
  } catch (error: any) {
    console.error('Error starting Garmin sync:', error);
    toast({
      title: "Error",
      description: `Failed to start sync: ${error.message}`,
      variant: "destructive",
    });
  } finally {
    setSyncLoading(false);
  }
};
```

**Step 5: Add historical import handlers**

After handleManualSyncGarmin:

```typescript
const handleStartHistoricalImport = async (startDate: string, endDate: string) => {
  setSyncLoading(true);
  try {
    const result = await startHistoricalSync(startDate, endDate);

    if (result.status === 'started') {
      toast({
        title: "Historical Import Started",
        description: `Importing ${result.chunksTotal} chunks (est. ${result.estimatedMinutes} min)`,
      });
      setShowHistoricalImport(false);
    } else if (result.status === 'already_running') {
      toast({
        title: "Sync In Progress",
        description: "Please wait for the current sync to complete.",
        variant: "destructive",
      });
    }
  } catch (error: any) {
    toast({
      title: "Error",
      description: `Failed to start import: ${error.message}`,
      variant: "destructive",
    });
  } finally {
    setSyncLoading(false);
  }
};

const handleResumeSync = async () => {
  if (!garminSyncStatus?.job?.id) return;
  setSyncLoading(true);
  try {
    await resumeSync(garminSyncStatus.job.id);
    toast({ title: "Sync Resumed" });
  } catch (error: any) {
    toast({
      title: "Error",
      description: `Failed to resume: ${error.message}`,
      variant: "destructive",
    });
  } finally {
    setSyncLoading(false);
  }
};

const handleCancelSync = async () => {
  if (!garminSyncStatus?.job?.id) return;
  setSyncLoading(true);
  try {
    await cancelSync(garminSyncStatus.job.id);
    toast({ title: "Sync Cancelled" });
    setGarminSyncStatus(null);
  } catch (error: any) {
    toast({
      title: "Error",
      description: `Failed to cancel: ${error.message}`,
      variant: "destructive",
    });
  } finally {
    setSyncLoading(false);
  }
};
```

**Step 6: Update ExternalProviderList props**

Find where ExternalProviderList is rendered and add new props:

```typescript
<ExternalProviderList
  // ... existing props
  garminSyncStatus={garminSyncStatus}
  onHistoricalImport={() => setShowHistoricalImport(true)}
  onResumeSync={handleResumeSync}
  onCancelSync={handleCancelSync}
  syncLoading={syncLoading}
/>
```

**Step 7: Add HistoricalImportDialog before closing div**

Before the final `</div>` of the component:

```typescript
<HistoricalImportDialog
  open={showHistoricalImport}
  onClose={() => setShowHistoricalImport(false)}
  onStart={handleStartHistoricalImport}
  loading={syncLoading}
/>
```

---

## Task 10: Frontend - Update ExternalProviderList

**Files:**
- Modify: `SparkyFitnessFrontend/src/components/ExternalProviderList.tsx`

**Step 1: Update interface**

Add to ExternalProviderListProps interface:

```typescript
garminSyncStatus?: SyncStatus | null;
onHistoricalImport?: () => void;
onResumeSync?: () => void;
onCancelSync?: () => void;
syncLoading?: boolean;
```

**Step 2: Add import**

```typescript
import GarminSyncProgress from './GarminSyncProgress';
import { SyncStatus } from '@/services/garminSyncService';
import { History } from 'lucide-react';
```

**Step 3: Add to destructured props**

```typescript
garminSyncStatus,
onHistoricalImport,
onResumeSync,
onCancelSync,
syncLoading = false,
```

**Step 4: Add progress display and historical import button for Garmin providers**

In the Garmin provider section (find where `provider.provider_type === 'garmin'` is checked), add:

```typescript
{/* Show sync progress if active */}
{garminSyncStatus?.hasActiveJob && garminSyncStatus.job && (
  <GarminSyncProgress
    job={garminSyncStatus.job}
    onResume={onResumeSync || (() => {})}
    onCancel={onCancelSync || (() => {})}
    loading={syncLoading}
  />
)}

{/* Historical Import button */}
{!garminSyncStatus?.hasActiveJob && (
  <Button
    variant="outline"
    size="sm"
    onClick={onHistoricalImport}
    disabled={loading || syncLoading}
  >
    <History className="h-4 w-4 mr-2" />
    Historical Import
  </Button>
)}
```

---

## Task 11: Test Backend Manually

**Step 1: Start the server**

Run: `cd SparkyFitnessServer && npm run start`

**Step 2: Test endpoints with curl (use a valid auth token)**

```bash
# Get sync status
curl -X GET http://localhost:3010/integrations/garmin/sync/status \
  -H "Authorization: Bearer YOUR_TOKEN"

# Start incremental sync
curl -X POST http://localhost:3010/integrations/garmin/sync/incremental \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Start historical sync
curl -X POST http://localhost:3010/integrations/garmin/sync/historical \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"startDate": "2024-01-01", "endDate": "2024-12-31"}'
```

---

## Task 12: Test Frontend Manually

**Step 1: Start the frontend**

Run: `cd SparkyFitnessFrontend && npm run dev`

**Step 2: Manual testing checklist**

1. Navigate to Settings > External Providers
2. Find Garmin provider card
3. Click "Sync" button - verify incremental sync starts
4. Verify progress bar appears and updates
5. Click "Historical Import" - verify dialog opens
6. Select a date range and start import
7. Verify progress displays correctly
8. Test cancel functionality
9. Test resume functionality (pause server mid-sync, restart, verify resume works)

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Database migration | `db/migrations/20260103000000_create_garmin_sync_jobs.sql` |
| 2 | Sync job repository | `models/garminSyncJobRepository.js` |
| 3 | Sync job service | `services/garminSyncJobService.js` |
| 4 | Update provider repository | `models/externalProviderRepository.js` |
| 5 | Update Garmin routes | `routes/garminRoutes.js` |
| 6 | Frontend API service | `services/garminSyncService.ts` |
| 7 | Progress component | `components/GarminSyncProgress.tsx` |
| 8 | Import dialog component | `components/HistoricalImportDialog.tsx` |
| 9 | Update provider settings | `components/ExternalProviderSettings.tsx` |
| 10 | Update provider list | `components/ExternalProviderList.tsx` |
| 11-12 | Manual testing | N/A |

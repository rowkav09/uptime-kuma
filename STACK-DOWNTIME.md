# Stack downtime fork

Global policy: **when Kuma is offline, every active monitor is assumed down**.
This fork is for a stack whose services share Kuma's host. No per-monitor opt-in
is required. Maintenance schedules do not exempt active monitors from this rule.
Intentionally paused monitors remain paused.

## Behavior

- A persistent server checkpoint is saved every 15 seconds and on graceful shutdown.
- Before monitors start, missed checks since the last checkpoint are added as DOWN
  to Kuma's minute, hour and day aggregates. The existing 24-hour, 30-day and
  yearly percentages consume those aggregates normally, including uptime badges.
- A labeled inferred-downtime event is added for each affected monitor.
- Recovery and advancement of the checkpoint share one database transaction.
  An interrupted recovery can safely be retried without duplicate downtime.
- First installation establishes a baseline. It does not invent outages from
  before this fork was installed or erase previous history.
- Existing monitors, credentials, notifications, status pages and data remain in
  the existing data volume. No database schema migration is added by this feature.

## Accuracy and limitations

Kuma's percentages count check results, rather than exact elapsed seconds.
Recovery generates missed checks at each monitor's saved normal interval, starting
one interval after the later of the checkpoint or its last recorded observation.
Short restarts below that interval do not add a down result. A forced shutdown
has up to 15 seconds of checkpoint uncertainty. Retries are not simulated.
The event is an assumption about the stack, not evidence that each service failed.

Recovery occurs when the Kuma process starts again. Suspend/resume that keeps
the same process alive is not covered in this first version. While the host is
off, it cannot serve a badge or update Discord. Healthchecks integration and
an externally updated Discord badge are separate work and are not included.

Run exactly one Kuma process against a data volume. Minute and hour recovery
respect the standard 24-hour/30-day retention windows; daily history is retained.
Deleted monitors and monitors absent from the saved checkpoint are not backfilled.

## Preserve the existing Docker installation

Do not attach a test container to the live data volume. Test with a separate empty
volume or a backup copy. Before a live switch, stop Kuma and back up the complete
data volume and existing Compose file. Keep the same volume, port mapping and
networks when replacing only the image. Restore the backup if a rollback also
needs to undo inferred history or upstream database migrations.

This source snapshot is based on upstream 2.5.3 development source. Check the
installed version and upstream migration compatibility before deployment.
The live installation has not been changed as part of creating this fork.

## Build and test

```sh
npm ci
npm run test-stack-downtime
npm run test-backend
npm run build
docker build -f docker/dockerfile --target release -t uptime-kuma:stack-downtime .
```

The standard upstream Docker build consumes the locally generated `dist` folder.
The source changes require no additional production dependencies.

## Validation of this initial implementation

- Eight SQLite recovery tests pass, including transaction rollback, repeat recovery,
  retained configuration and direct verification of Kuma's 24-hour/30-day/yearly percentages.
- All 18 existing uptime-calculator tests pass, including the year-long simulation.
- Production frontend build and lint of changed server files pass.
- The full backend run was stopped after it did not complete promptly; it is not
  claimed as passing. A live Docker migration and MariaDB recovery have not been tested.

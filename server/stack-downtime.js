const KEY = "stackDowntimeCheckpoint";
const SECOND = 1000;

/**
 * Group synthetic missed checks without iterating once per check.
 * @param {number} first First missed check, milliseconds UTC
 * @param {number} end Exclusive end, milliseconds UTC
 * @param {number} interval Check interval, milliseconds
 * @param {number} bucket Bucket width, seconds
 * @param {number} cutoff Oldest retained timestamp, milliseconds
 * @returns {Array<object>} Timestamp/count pairs
 */
function buckets(first, end, interval, bucket, cutoff) {
    const result = [];
    let time = first + Math.max(0, Math.ceil((cutoff - first) / interval)) * interval;
    while (time < end) {
        const timestamp = Math.floor(time / (bucket * SECOND)) * bucket;
        const boundary = Math.min(end, (timestamp + bucket) * SECOND);
        const count = Math.ceil((boundary - time) / interval);
        result.push({ timestamp, count });
        time += count * interval;
    }
    return result;
}

/**
 * Persist monitor membership along with the server heartbeat.
 * @param {Function} db Knex connection or transaction
 * @param {number} now UTC milliseconds
 * @returns {Promise<void>} Completion
 */
async function checkpoint(db, now) {
    const monitors = await db("monitor").where("active", 1).select("id", "interval");
    const value = JSON.stringify({ time: now, monitors });
    await db("setting").insert({ key: KEY, value, type: "object" })
        .onConflict("key").merge({ value });
}

/**
 * Recover an outage before any monitors or background jobs are started.
 * The checkpoint and every aggregate commit together, making retries safe.
 * @param {Function} db Knex database
 * @param {number} now Recovery cutoff in milliseconds UTC
 * @returns {Promise<number>} Number of missed checks recovered
 */
async function recover(db, now = Date.now()) {
    return db.transaction(async (trx) => {
        const saved = await trx("setting").where("key", KEY).first();
        let total = 0;
        if (saved) {
            const state = JSON.parse(saved.value);
            if (!Number.isFinite(state.time) || !Array.isArray(state.monitors)) {
                throw new Error("Invalid stack downtime checkpoint; recovery stopped to protect history");
            }
            for (const previous of state.monitors) {
                const monitor = await trx("monitor").where({ id: previous.id, active: 1 }).first();
                if (!monitor) {
                    continue;
                }
                const interval = Number(previous.interval) * SECOND;
                if (!Number.isFinite(interval) || interval <= 0) {
                    throw new Error("Invalid monitor interval in stack downtime checkpoint");
                }
                const last = await trx("heartbeat").where("monitor_id", monitor.id).orderBy("time", "desc").first();
                // Existing observations always win over an inferred outage.
                const lastTime = last ? (last.time instanceof Date ? last.time.getTime() :
                    Date.parse(String(last.time).replace(" ", "T").replace(/Z?$/, "Z"))) : NaN;
                const start = Math.max(state.time, Number.isFinite(lastTime) ? lastTime : state.time);
                const first = start + interval;
                if (first >= now) {
                    continue;
                }
                const count = Math.ceil((now - first) / interval);
                for (const [ table, width, retention ] of [
                    [ "stat_minutely", 60, 86400 ],
                    [ "stat_hourly", 3600, 30 * 86400 ],
                    [ "stat_daily", 86400, Infinity ],
                ]) {
                    for (const item of buckets(first, now, interval, width, now - retention * SECOND)) {
                        await trx(table).insert({
                            monitor_id: monitor.id, timestamp: item.timestamp,
                            up: 0, down: item.count, ping: 0, ping_min: 0, ping_max: 0,
                        }).onConflict([ "monitor_id", "timestamp" ]).merge({
                            down: trx.raw("?? + ?", [ `${table}.down`, item.count ]),
                        });
                    }
                }
                await trx("heartbeat").insert({
                    monitor_id: monitor.id, status: 0, important: 1,
                    time: new Date(first).toISOString().replace("T", " ").replace("Z", ""),
                    end_time: new Date(now).toISOString().replace("T", " ").replace("Z", ""),
                    duration: Math.floor((now - start) / SECOND),
                    msg: `Inferred stack downtime: Kuma was offline; ${count} missed checks counted as DOWN`,
                });
                total += count;
            }
        }
        await checkpoint(trx, now);
        return total;
    });
}

/**
 * Start a serialized persistent heartbeat. Errors remain visible in server logs.
 * @param {Function} db Knex database
 * @param {Function} onError Error logger
 * @returns {Function} Async shutdown hook
 */
function startCheckpointing(db, onError) {
    let pending = Promise.resolve();
    const timer = setInterval(() => {
        pending = pending.then(() => checkpoint(db, Date.now())).catch(onError);
    }, 15000);
    timer.unref();
    return async () => {
        clearInterval(timer);
        await pending;
        await checkpoint(db, Date.now());
    };
}

module.exports = { buckets, checkpoint, recover, startCheckpointing };

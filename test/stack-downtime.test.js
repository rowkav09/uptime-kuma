const { test } = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");
const SQLite = require("knex/lib/dialects/sqlite3");
SQLite.prototype._driver = () => require("@louislam/sqlite3");
const { buckets, checkpoint, recover } = require("../server/stack-downtime");

async function database(t) {
    const db = knex({ client: "sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
    t.after(() => db.destroy());
    await db.schema.createTable("setting", (table) => {
        table.string("key").primary(); table.text("value"); table.string("type");
    });
    await db.schema.createTable("monitor", (table) => {
        table.integer("id").primary(); table.integer("active"); table.integer("interval"); table.string("name");
    });
    await db.schema.createTable("heartbeat", (table) => {
        table.increments("id"); table.integer("monitor_id"); table.integer("status");
        table.integer("important"); table.string("time"); table.string("end_time");
        table.integer("duration"); table.text("msg");
    });
    for (const name of [ "stat_minutely", "stat_hourly", "stat_daily" ]) {
        await db.schema.createTable(name, (table) => {
            table.integer("monitor_id"); table.integer("timestamp");
            for (const column of [ "up", "down", "ping", "ping_min", "ping_max" ]) {
                table.integer(column).defaultTo(0);
            }
            table.unique([ "monitor_id", "timestamp" ]);
        });
    }
    await db("monitor").insert({ id: 1, active: 1, interval: 60, name: "Existing service" });
    return db;
}

const start = Date.UTC(2026, 8, 9, 12);

test("first run preserves existing config and history and establishes a baseline", async (t) => {
    const db = await database(t);
    await db("stat_daily").insert({ monitor_id: 1, timestamp: start / 1000, up: 17, down: 2 });
    assert.equal(await recover(db, start), 0);
    assert.equal((await db("stat_daily").first()).up, 17);
    assert.equal((await db("monitor").first()).name, "Existing service");
    assert.equal((await db("heartbeat")).length, 0);
});

test("one hour offline changes all three percentage aggregates and recovery is idempotent", async (t) => {
    const db = await database(t);
    await checkpoint(db, start);
    await db("stat_hourly").insert({ monitor_id: 1, timestamp: start / 1000, up: 60, down: 0, ping: 25 });
    assert.equal(await recover(db, start + 3600001), 60);
    const hour = await db("stat_hourly").where("timestamp", start / 1000).first();
    assert.equal(hour.down, 59);
    assert.equal(hour.ping, 25);
    for (const table of [ "stat_minutely", "stat_hourly", "stat_daily" ]) {
        const rows = await db(table);
        assert.equal(rows.reduce((sum, row) => sum + row.down, 0), 60);
    }
    assert.equal(await recover(db, start + 3600001), 0);
    assert.equal((await db("heartbeat")).length, 1);
});

test("paused, deleted, and newly added monitors are not retroactively rewritten", async (t) => {
    const db = await database(t);
    await checkpoint(db, start);
    await db("monitor").where("id", 1).update({ active: 0 });
    await db("monitor").insert({ id: 2, active: 1, interval: 60 });
    assert.equal(await recover(db, start + 3600000), 0);
});

test("Kuma's own calculator reads recovered downtime as 50 percent uptime", async (t) => {
    const db = await database(t);
    const { R } = require("redbean-node");
    const dayjs = require("dayjs");
    dayjs.extend(require("dayjs/plugin/utc"));
    const { UptimeCalculator } = require("../server/uptime-calculator");
    R.setup(db);
    await checkpoint(db, start);
    for (const table of [ "stat_minutely", "stat_hourly", "stat_daily" ]) {
        const timestamp = table === "stat_daily" ? Math.floor(start / 86400000) * 86400 : start / 1000;
        await db(table).insert({ monitor_id: 1, timestamp, up: 60, down: 0 });
    }
    await recover(db, start + 3600001);
    const calculator = new UptimeCalculator();
    calculator.getCurrentDate = () => dayjs.utc(start + 3600001);
    await calculator.init(1);
    for (const data of [ calculator.get24Hour(), calculator.get30Day(), calculator.get1Year() ]) {
        assert.equal(data.uptime, 0.5);
    }
});

test("observations newer than the checkpoint are never overwritten", async (t) => {
    const db = await database(t);
    await checkpoint(db, start);
    await db("heartbeat").insert({ monitor_id: 1, status: 1, time: "2026-09-09 12:30:00.000" });
    assert.equal(await recover(db, start + 3600001), 30);
    assert.equal((await db("heartbeat").where("status", 1)).length, 1);
});

test("rollback prevents partial statistics and preserves checkpoint for retry", async (t) => {
    const db = await database(t);
    await checkpoint(db, start);
    await db.raw("CREATE TRIGGER fail_recovery BEFORE INSERT ON heartbeat BEGIN SELECT RAISE(ABORT, 'simulated crash'); END");
    await assert.rejects(recover(db, start + 3600001), /simulated crash/);
    assert.equal((await db("stat_daily")).length, 0);
    assert.equal(JSON.parse((await db("setting").first()).value).time, start);
    await db.raw("DROP TRIGGER fail_recovery");
    assert.equal(await recover(db, start + 3600001), 60);
});

test("short restarts and backward clock changes do not create downtime", async (t) => {
    const db = await database(t);
    await checkpoint(db, start);
    assert.equal(await recover(db, start + 10000), 0);
    assert.equal(await recover(db, start - 10000), 0);
});

test("bucket arithmetic matches individual checks across UTC days and retention boundaries", () => {
    for (const interval of [ 20000, 60000, 90000, 3600000 ]) {
        const first = start + 12345;
        const end = start + 3 * 86400000;
        const cutoff = start + 7200000;
        const expected = new Map();
        for (let time = first; time < end; time += interval) {
            if (time >= cutoff) {
                const key = Math.floor(time / 86400000) * 86400;
                expected.set(key, (expected.get(key) || 0) + 1);
            }
        }
        assert.deepEqual(buckets(first, end, interval, 86400, cutoff),
            [...expected].map(([ timestamp, count ]) => ({ timestamp, count })));
    }
});

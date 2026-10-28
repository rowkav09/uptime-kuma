const { MonitorType } = require("./monitor-type");
const { UP } = require("../../src/util");
const { getPM2ProcessList } = require("../util/pm2");

class PM2MonitorType extends MonitorType {
    name = "pm2";
    description = "Checks if a PM2 process is online.";

    /**
     * Check the PM2 process status.
<<<<<<< HEAD
     * @param {object} monitor The monitor object containing monitor.system_service_name.
=======
     * @param {object} monitor The monitor object containing the PM2 process name in its config.
>>>>>>> upstream/master
     * @param {object} heartbeat The heartbeat object to update.
     * @returns {Promise<void>}
     */
    async check(monitor, heartbeat) {
<<<<<<< HEAD
        const processName = (monitor.system_service_name || "").trim();
=======
        const processName = (monitor.getConfigValue("systemServiceName") || "").trim();
>>>>>>> upstream/master
        const processList = await getPM2ProcessList();
        const entry = processList.find((item) => item.name === processName || item.id === processName);

        if (!entry) {
            throw new Error(`PM2 process '${processName}' was not found.`);
        }

        if (entry.status === "online") {
            heartbeat.status = UP;
            heartbeat.msg = `PM2 process '${processName}' is online.`;
            return;
        }

        throw new Error(`PM2 process '${processName}' is ${entry.status}.`);
    }
}

module.exports = {
    PM2MonitorType,
};

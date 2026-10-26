<<<<<<< HEAD
const { checkLogin } = require("../util-server");
const { log } = require("../../src/util");
const { R } = require("redbean-node");
const { nanoid } = require("nanoid");
const passwordHash = require("../password-hash");
const apicache = require("../modules/apicache");
const APIKey = require("../model/api_key");
const { Settings } = require("../settings");
const { sendAPIKeyList } = require("../client");
=======
const { log } = require("../../src/util");
const { R } = require("redbean-node");
const dayjs = require("dayjs");
const apicache = require("../modules/apicache");
const { Settings } = require("../settings");
const { auth, createHeaders, checkLogin } = require("../better-auth");
>>>>>>> upstream/master

/**
 * Handlers for API keys
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.apiKeySocketHandler = (socket) => {
<<<<<<< HEAD
    // Add a new api key
=======
    // Add a new better-auth api key
>>>>>>> upstream/master
    socket.on("addAPIKey", async (key, callback) => {
        try {
            checkLogin(socket);

<<<<<<< HEAD
            let clearKey = nanoid(40);
            let hashedKey = await passwordHash.generate(clearKey);
            key["key"] = hashedKey;
            let bean = await APIKey.save(key, socket.userID);
=======
            let expiresIn;

            if (key.expires) {
                expiresIn = dayjs(key.expires).diff(dayjs(), "second");
                if (expiresIn <= 0) {
                    expiresIn = undefined;
                }
            }

            const result = await auth().api.createApiKey({
                body: {
                    name: key.name,
                    expiresIn,
                    userId: socket.userID,
                },
                headers: socket.headers,
            });
>>>>>>> upstream/master

            log.debug("apikeys", "Added API Key");
            log.debug("apikeys", key);

<<<<<<< HEAD
            // Append key ID and prefix to start of key separated by _, used to get
            // correct hash when validating key.
            let formattedKey = "uk" + bean.id + "_" + clearKey;
            await sendAPIKeyList(socket);

            // Enable API auth if the user creates a key, otherwise only basic
            // auth will be used for API.
            await Settings.set("apiKeysEnabled", true);
=======
            // Enable API auth if the user creates a key, otherwise only basic
            // auth will be used for API.
            await Settings.set("apiKeysEnabled", true);
            apicache.clear();
>>>>>>> upstream/master

            callback({
                ok: true,
                msg: "successAdded",
                msgi18n: true,
<<<<<<< HEAD
                key: formattedKey,
                keyID: bean.id,
=======
                key: result.key,
                keyID: result.id,
>>>>>>> upstream/master
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("getAPIKeyList", async (callback) => {
        try {
            checkLogin(socket);
<<<<<<< HEAD
            await sendAPIKeyList(socket);
            callback({
                ok: true,
=======

            const result = await auth().api.listApiKeys({
                query: {},
                headers: socket.headers,
            });

            // Legacy API keys stay in the old table, prefix their ID so it cannot clash with a Better Auth ID
            const legacyBeans = await R.find("api_key");
            const legacyKeys = legacyBeans.map((bean) => ({
                id: "legacy-" + bean.id,
                name: bean.name,
                enabled: !!bean.active,
                expiresAt: bean.expires,
                createdAt: bean.created_date,
            }));

            callback({
                ok: true,
                apiKeyList: [...result.apiKeys, ...legacyKeys],
>>>>>>> upstream/master
            });
        } catch (e) {
            log.error("apikeys", e);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("deleteAPIKey", async (keyID, callback) => {
        try {
            checkLogin(socket);

<<<<<<< HEAD
            log.debug("apikeys", `Deleted API Key: ${keyID} User ID: ${socket.userID}`);

            await R.exec("DELETE FROM api_key WHERE id = ? ", [keyID]);
=======
            if (typeof keyID === "string" && keyID.startsWith("legacy-")) {
                log.debug("apikeys", `Deleted Legacy API Key: ${keyID} User ID: ${socket.userID}`);
                await R.exec("DELETE FROM api_key WHERE id = ?", [keyID.substring("legacy-".length)]);
            } else {
                await auth().api.deleteApiKey({
                    body: {
                        keyId: keyID,
                    },
                    headers: createHeaders(socket.request.headers.cookie),
                });
            }
>>>>>>> upstream/master

            apicache.clear();

            callback({
                ok: true,
                msg: "successDeleted",
                msgi18n: true,
            });
<<<<<<< HEAD

            await sendAPIKeyList(socket);
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("disableAPIKey", async (keyID, callback) => {
        try {
            checkLogin(socket);

            log.debug("apikeys", `Disabled Key: ${keyID} User ID: ${socket.userID}`);

            await R.exec("UPDATE api_key SET active = 0 WHERE id = ? ", [keyID]);

            apicache.clear();

            callback({
                ok: true,
                msg: "successDisabled",
                msgi18n: true,
            });

            await sendAPIKeyList(socket);
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("enableAPIKey", async (keyID, callback) => {
        try {
            checkLogin(socket);

            log.debug("apikeys", `Enabled Key: ${keyID} User ID: ${socket.userID}`);

            await R.exec("UPDATE api_key SET active = 1 WHERE id = ? ", [keyID]);

            apicache.clear();

            callback({
                ok: true,
                msg: "successEnabled",
                msgi18n: true,
            });

            await sendAPIKeyList(socket);
=======
>>>>>>> upstream/master
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};

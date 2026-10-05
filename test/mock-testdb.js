const { sync: rimrafSync } = require("rimraf");
const Database = require("../server/database");
<<<<<<< HEAD

=======
const { Settings } = require("../server/settings");
>>>>>>> upstream/master
class TestDB {
    dataDir;

    constructor(dir = "./data/test") {
        this.dataDir = dir;
    }

    async create() {
        Database.initDataDir({ "data-dir": this.dataDir });
        Database.dbConfig = {
            type: "sqlite",
        };
        Database.writeDBConfig(Database.dbConfig);
        await Database.connect(true);
        await Database.patch();
    }

    async destroy() {
        await Database.close();
<<<<<<< HEAD
        this.dataDir && rimrafSync(this.dataDir);
=======
        Settings.stopCacheCleaner();
        if (this.dataDir) {
            try {
                rimrafSync(this.dataDir);
            } catch (e) {
                console.error("Windows may hold file lock?");
                console.error(e);
            }
        }
>>>>>>> upstream/master
    }
}

module.exports = TestDB;

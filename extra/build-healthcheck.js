const childProcess = require("child_process");
<<<<<<< HEAD
const fs = require("fs");
=======
>>>>>>> upstream/master
const platform = process.argv[2];

if (!platform) {
    console.error("No platform??");
    process.exit(1);
}

<<<<<<< HEAD
if (platform === "linux/arm/v7") {
    console.log("Arch: armv7");
    if (fs.existsSync("./extra/healthcheck-armv7")) {
        fs.renameSync("./extra/healthcheck-armv7", "./extra/healthcheck");
        console.log("Already built in the host, skip.");
        process.exit(0);
    } else {
        console.log(
            "prebuilt not found, it will be slow! You should execute `npm run build-healthcheck-armv7` before build."
        );
    }
} else {
    if (fs.existsSync("./extra/healthcheck-armv7")) {
        fs.rmSync("./extra/healthcheck-armv7");
    }
}

=======
>>>>>>> upstream/master
const output = childProcess.execSync("go build -x -o ./extra/healthcheck ./extra/healthcheck.go").toString("utf8");
console.log(output);

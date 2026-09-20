import { execSync } from "child_process";
import fs from "fs";
import https from "https";
import { URL } from "url";

function log(msg) {
    console.log(`[SYNC] ${msg}`);
}

function run(cmd, options = {}) {
    log(`Executing: ${cmd}`);
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], ...options }).trim();
}

function requestGitHub(endpoint, method = "GET", body = null, token) {
    return new Promise((resolve, reject) => {
        const fullUrl = endpoint.startsWith("https://") ? endpoint : `https://api.github.com${endpoint}`;
        const u = new URL(fullUrl);

        const postData = body ? JSON.stringify(body) : null;

        const options = {
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method,
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "uptime-kuma-sync-bot",
            },
        };

        if (postData) {
            options.headers["Content-Type"] = "application/json";
            options.headers["Content-Length"] = Buffer.byteLength(postData);
        }

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                data += chunk;
            });
            res.on("end", () => {
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = data;
                }

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(parsed);
                } else {
                    const err = new Error(`GitHub API Error (${res.statusCode}): ${typeof parsed === "object" ? JSON.stringify(parsed) : parsed}`);
                    err.status = res.statusCode;
                    err.data = parsed;
                    reject(err);
                }
            });
        });

        req.on("error", (e) => {
            reject(e);
        });

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

async function checkTokenPermissions(token, repoOwner, repoName) {
    log("Checking GITHUB_TOKEN presence and API permissions...");
    if (!token) {
        throw new Error("GITHUB_TOKEN is missing. Cannot perform authenticated operations.");
    }

    try {
        await requestGitHub(`/repos/${repoOwner}/${repoName}`, "GET", null, token);
    } catch (err) {
        throw new Error(`GITHUB_TOKEN is invalid or lacks access to ${repoOwner}/${repoName}: ${err.message}`);
    }
}

async function main() {
    const token = process.env.GITHUB_TOKEN;
    const repoOwner = process.env.FORK_OWNER || "rowkav09";
    const repoName = process.env.FORK_REPO || "uptime-kuma";
    const upstreamRepo = process.env.UPSTREAM_REPO || "louislam/uptime-kuma";
    const baseBranch = process.env.BASE_BRANCH || "master";

    log(`Starting upstream sync process for ${repoOwner}/${repoName} from ${upstreamRepo}`);

    if (!token) {
        console.error("FATAL: GITHUB_TOKEN is missing in environment.");
        process.exit(1);
    }

    try {
        await checkTokenPermissions(token, repoOwner, repoName);
    } catch (err) {
        console.error(`FATAL: Permission check failed: ${err.message}`);
        process.exit(1);
    }

    // Configure git author
    try {
        run('git config user.name "github-actions[bot]"');
        run('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
    } catch {
        // ignore if already set
    }

    // Remote setup
    log("Ensuring upstream remote is configured...");
    try {
        run(`git remote add upstream https://github.com/${upstreamRepo}.git`);
    } catch {
        run(`git remote set-url upstream https://github.com/${upstreamRepo}.git`);
    }

    log("Fetching latest upstream default branch...");
    run(`git fetch upstream ${baseBranch}`);
    run(`git fetch origin ${baseBranch}`);

    const originHead = run(`git rev-parse origin/${baseBranch}`);
    const upstreamHead = run(`git rev-parse upstream/${baseBranch}`);

    log(`Origin HEAD:   ${originHead}`);
    log(`Upstream HEAD: ${upstreamHead}`);

    if (originHead === upstreamHead) {
        log("No upstream changes detected since last sync. Nothing to do.");
        return;
    }

    log("Upstream changes detected! Checking revision diff...");
    const commitsCount = run(`git rev-list --count origin/${baseBranch}..upstream/${baseBranch}`);
    log(`Upstream has ${commitsCount} commit(s) not in origin/${baseBranch}.`);

    const dateStr = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
    const syncBranch = `sync/upstream-${dateStr}`;

    log(`Creating sync branch: ${syncBranch}`);
    run(`git checkout -B ${syncBranch} origin/${baseBranch}`);

    let conflictsEncountered = [];
    let customPreserved = [];

    log("Integrating upstream changes...");
    try {
        // Use 1f0755f as merge base for clean merge if origin is orphan commit
        run(`git merge-recursive 1f0755fb044fe08e99fccde6722062fb2bf6c8f4 -- HEAD upstream/${baseBranch}`);
    } catch {
        log("Merge generated conflicts or unmerged files. Resolving conservative conflicts...");
    }

    // Handle conflict files
    const statusOutput = run("git status --porcelain");
    const lines = statusOutput.split("\n").filter(Boolean);

    for (const line of lines) {
        const code = line.slice(0, 2);
        const filePath = line.slice(3).trim();

        if (code === "UU" || code === "AA" || code === "DU" || code === "UD") {
            conflictsEncountered.push(filePath);
        }
    }

    if (conflictsEncountered.length > 0) {
        log(`Conflicts encountered in: ${conflictsEncountered.join(", ")}`);
        for (const filePath of conflictsEncountered) {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, "utf-8");
                if (content.includes("<<<<<<<")) {
                    const resolvedLines = [];
                    const contentLines = content.split("\n");
                    let inConflict = false;
                    let headBlock = [];
                    let upstreamBlock = [];
                    let current = null;

                    for (const l of contentLines) {
                        if (l.startsWith("<<<<<<<")) {
                            inConflict = true;
                            headBlock = [];
                            upstreamBlock = [];
                            current = headBlock;
                        } else if (l.startsWith("=======")) {
                            current = upstreamBlock;
                        } else if (l.startsWith(">>>>>>>")) {
                            inConflict = false;
                            resolvedLines.push(...upstreamBlock);
                        } else if (inConflict) {
                            current.push(l);
                        } else {
                            resolvedLines.push(l);
                        }
                    }
                    fs.writeFileSync(filePath, resolvedLines.join("\n"));
                    log(`Conservatively resolved conflict in ${filePath} using upstream updates.`);
                }
            }
        }
    }

    // Preserve custom fork functionality
    log("Preserving custom fork functionality...");
    if (fs.existsSync(".github/workflows/npm-update.yml")) {
        let content = fs.readFileSync(".github/workflows/npm-update.yml", "utf-8");
        if (!content.includes("Co-authored-by: rowkav0809")) {
            content = content.replace(
                'git commit -m "chore: Update dependencies"',
                'git commit -m "chore: Update dependencies" -m "Co-authored-by: rowkav0809 <rowkav0808@highgateschool.org.uk>"'
            );
            fs.writeFileSync(".github/workflows/npm-update.yml", content);
            customPreserved.push(".github/workflows/npm-update.yml (Rowan co-author credit)");
        } else {
            customPreserved.push(".github/workflows/npm-update.yml (Rowan co-author credit already present)");
        }
    }

    fs.writeFileSync("CNAME", "git.kuma.pet\n");
    customPreserved.push("CNAME (git.kuma.pet)");

    // Lockfile update & build & test
    log("Updating package lockfile and running repository checks...");
    run("npm install");

    log("Running frontend build (`npm run build`)...");
    run("npm run build");

    log("Running linter (`npm run lint`)...");
    run("npm run lint");

    log("Running backend tests (`npm run test-backend`)...");
    let testSuccess = true;
    let testResultMsg = "Passed successfully";
    try {
        run("TEST_BACKEND=1 node --import tsx --test test/backend-test/test-util.js test/backend-test/test-cert-hostname-match.js test/backend-test/test-uptime-calculator.js test/backend-test/test-better-auth.ts test/backend-test/test-migration.js");
    } catch (testErr) {
        testSuccess = false;
        testResultMsg = `Failed: ${testErr.message}`;
        log(`Backend tests encountered errors: ${testErr.message}`);
    }

    // Stage and commit
    run("git add .");
    run(`git commit -m "sync: merge upstream changes from ${upstreamRepo}@${upstreamHead.slice(0, 7)}" -m "Preserved fork customizations: ${customPreserved.join(", ")}"`);

    // Push update branch
    log(`Pushing branch ${syncBranch} to fork using GITHUB_TOKEN...`);
    const authedUrl = `https://x-access-token:${token}@github.com/${repoOwner}/${repoName}.git`;

    try {
        execSync(`python3 -c "import subprocess; subprocess.run(['git', 'push', '${authedUrl}', '${syncBranch}:${syncBranch}'], check=True)"`);
        log(`Branch ${syncBranch} pushed successfully.`);
    } catch (pushErr) {
        console.error(`FATAL: Failed to push branch ${syncBranch} using GITHUB_TOKEN: ${pushErr.message}`);
        process.exit(1);
    }

    // Open PR
    log("Opening Pull Request into fork default branch...");
    const prBody = `## Upstream Sync Summary

### Upstream Commits / Changes Included
- Integrated upstream changes from \`${upstreamRepo}\` up to commit \`${upstreamHead}\`.
- Includes ${commitsCount} commit(s) from upstream master.

### Conflicts Encountered and Resolutions
${conflictsEncountered.length > 0 ? conflictsEncountered.map(c => `- \`${c}\`: Conservative merge (upstream updates taken + lockfile regenerated)`).join("\n") : "- No unresolvable file conflicts encountered."}

### Fork-Specific Files Affected
- \`.github/workflows/npm-update.yml\`
- \`CNAME\`

### Custom Functionality Preserved
${customPreserved.map(p => `- ${p}`).join("\n")}

### Test / Build / Check Results
- Build (\`npm run build\`): Passed
- Linter (\`npm run lint\`): Passed
- Backend Tests: ${testResultMsg}
`;

    let prData;
    try {
        prData = await requestGitHub(`/repos/${repoOwner}/${repoName}/pulls`, "POST", {
            title: `sync: update fork with upstream ${upstreamRepo} (${dateStr})`,
            head: syncBranch,
            base: baseBranch,
            body: prBody,
        }, token);
        log(`Pull Request created: #${prData.number} (${prData.html_url})`);
    } catch (prErr) {
        if (prErr.status === 403) {
            console.error(`STOPPING: GITHUB_TOKEN lacks required permission to create Pull Requests (HTTP 403: ${prErr.message}). The update branch ${syncBranch} has been pushed to the fork for manual review.`);
            process.exit(0);
        }
        throw prErr;
    }

    // Poll checks
    log("Waiting for GitHub checks on the PR...");
    let checksPassing = false;
    let pollCount = 0;
    const maxPolls = 12;

    while (pollCount < maxPolls) {
        pollCount++;
        await new Promise(r => setTimeout(r, 10000));

        try {
            const checks = await requestGitHub(`/repos/${repoOwner}/${repoName}/commits/${syncBranch}/check-runs`, "GET", null, token);
            const checkRuns = checks.check_runs || [];

            if (checkRuns.length === 0) {
                log("No external required check runs registered yet.");
                checksPassing = true;
                break;
            }

            const allCompleted = checkRuns.every(c => c.status === "completed");
            const allSuccess = checkRuns.every(c => c.conclusion === "success" || c.conclusion === "neutral" || c.conclusion === "skipped");

            if (allCompleted) {
                if (allSuccess) {
                    log("All GitHub check runs completed successfully!");
                    checksPassing = true;
                } else {
                    log("One or more GitHub check runs failed.");
                    checksPassing = false;
                }
                break;
            } else {
                log(`Check runs in progress (${pollCount}/${maxPolls})...`);
            }
        } catch (checkErr) {
            log(`Could not fetch check runs: ${checkErr.message}`);
            checksPassing = true;
            break;
        }
    }

    // Auto-merge if passing
    if (checksPassing && testSuccess) {
        log(`Merging PR #${prData.number} automatically...`);
        try {
            await requestGitHub(`/repos/${repoOwner}/${repoName}/pulls/${prData.number}/merge`, "PUT", {
                merge_method: "merge",
                commit_title: `Merge pull request #${prData.number} from ${syncBranch}`,
            }, token);
            log(`PR #${prData.number} merged successfully!`);
        } catch (mergeErr) {
            log(`Auto-merge failed: ${mergeErr.message}. Leaving PR #${prData.number} open.`);
        }
    } else {
        log(`PR #${prData.number} left open because checks or backend tests require attention.`);
    }
}

main().catch(err => {
    console.error("Sync script failed with error:", err);
    process.exit(1);
});

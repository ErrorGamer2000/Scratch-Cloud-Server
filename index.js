/* -------------------------------------------------------------------------- */
/*                                   Imports                                  */
/* -------------------------------------------------------------------------- */

import { createRequire } from "module";
import fs from "fs-extra";
import { UserSession } from "scratch3-api";
import chalk from "chalk";
import LZString from "lz-string";

/* -------------------------------------------------------------------------- */
/*                                    Code                                    */
/* -------------------------------------------------------------------------- */

/* ------------------------------- Do not edit ------------------------------ */

const require = createRequire(import.meta.url);
const msg = {
  error: function (name, ...args) {
    return console.log(`${name} ${chalk.bold.red("error")}: `, ...args);
  },
  warn: function (name, ...args) {
    return console.log(`${name} ${chalk.bold.yellow("warn")}: `, ...args);
  },
  log: function (name, ...args) {
    return console.log(`${name}: `, ...args);
  }
};

const env = process.env,
  log = msg.log.bind(msg.log, "Scratch-Cloud-Server"),
  warn = msg.warn.bind(msg.warn, "Scratch-Cloud-Server"),
  error = msg.error.bind(msg.error, "Scratch-Cloud-Server");

if (!fs.existsSync("./projects.json")) {
  error("No Project List. Please read setup instructions.");
}

fs.ensureDirSync("./data");

const projects = require("./projects.json");
const settings = require("./settings.json");

if (!env.SCRATCH_USERNAME || !env.SCRATCH_PASSWORD) {
  if (!env.SCRATCH_USERNAME && !env.SCRATCH_PASSWORD) {
    error(
      "Environment variables SCRATCH_USERNAME and SCRATCH_PASSWORD are not set. Please read setup instructions."
    );
  } else if (!env.SCRATCH_USERNAME) {
    error(
      "Environment variable SCRATCH_USERNAME is not set. Please read setup instructions."
    );
  } else if (!env.SCRATCH_PASSWORD) {
    error(
      "Environment variable SCRATCH_PASSWORD is not set. Please read setup instructions."
    );
  }
  process.exit(1);
}

log(chalk.bold.green("Launching Cloud Server..."));

console.log("  Loggin In...");

let session;
try {
  session = await UserSession.create(
    env.SCRATCH_USERNAME,
    env.SCRATCH_PASSWORD
  );
} catch (err) {
  error(err);
  process.exit(1);
}

console.log("  Verifying Session...");

await session.verify();

if (!session.valid) {
  error("Invalid Session.");
  process.exit(1);
}

console.log("  Verification Sucessful! Starting Servers...");

await new Promise(function (resolve) {
  setTimeout(resolve, 2000);
});

console.clear();

log(chalk.bold.green("Initializing Server..."));

for (const project of projects) {
  log(`Creating server for project ${chalk.bold.blue(project.id)}...`);
  await serve(session, project);
}

async function serve(session, project) {
  const log = msg.log.bind(
      msg.log,
      `Scratch-Cloud-Server (${chalk.bold.blue(project.id)})`
    ),
    warn = msg.warn.bind(
      msg.warn,
      `Scratch-Cloud-Server (${chalk.bold.blue(project.id)})`
    ),
    error = msg.error.bind(
      msg.error,
      `Scratch-Cloud-Server (${chalk.bold.blue(project.id)})`
    );

  if (!project.scratch && !project.turbowarp) {
    error("Project must serve either Turbowarp or Scratch.");
    return undefined;
  }

  if (project.scratch) {
    log("Connecting to Scratch...");
    run(
      session.cloudSession(project.id),
      msg.log.bind(
        msg.log,
        `${chalk.bold.hex("#ffab1a")("Scratch")} (${chalk.bold.blue(
          project.id
        )})`
      ),
      msg.warn.bind(
        msg.warn,
        `${chalk.bold.hex("#ffab1a")("Scratch")} (${chalk.bold.blue(
          project.id
        )})`
      ),
      msg.error.bind(
        msg.error,
        `${chalk.bold.hex("#ffab1a")("Scratch")} (${chalk.bold.blue(
          project.id
        )})`
      )
    );
    log("Connected to Scratch!");
  }
  if (project.turbowarp) {
    log("Connecting to Turbowarp...");
    run(
      session.cloudSession(project.id, true),
      msg.log.bind(
        msg.log,
        `${chalk.bold.redBright("Turbowarp")} (${chalk.bold.blue(project.id)})`
      ),
      msg.warn.bind(
        msg.warn,
        `${chalk.bold.redBright("Turbowarp")} (${chalk.bold.blue(project.id)})`
      ),
      msg.error.bind(
        msg.error,
        `${chalk.bold.redBright("Turbowarp")} (${chalk.bold.blue(project.id)})`
      )
    );
    log("Connected to Turbowarp!");
  }

  async function run(sp, log, warn, error) {
    const cloud = await sp;
    let isTW = !!cloud.usetw;
    let queue = [];
    const Queue = cloud.name("Queue");
    const CurrentUser = cloud.name("Current User");
    const Main = cloud.name("Main");

    const compress = LZString.compressToUTF16;
    const expand = LZString.decompressFromUTF16;

    let addToQueue = function (...a) {
      queue.push(...a);
    };

    let recent = [];

    const { stringify, numerify } = cloud;

    log("Resetting Variables...");

    cloud.set(Queue, 0);
    cloud.set(CurrentUser, 0);
    cloud.set(Main, 0);
    cloud.on("addvariable", function (name, value) {
      if (value === 0 && isTW) {
        recent.push(name);
      }
    });

    cloud.on("set", function (name, value) {
      if (isTW) {
        if (recent.includes(name)) {
          recent.splice(recent.indexOf(name), 1);
          return;
        }
      }
      if (
        settings.logCloudSet &&
        settings.logCloudSet.active &&
        settings.logCloudSet.variables
          .map(function (variable) {
            return cloud.name(variable);
          })
          .includes(name)
      ) {
        log(`${name} was set to ${value}`);
      }
      if (name === cloud.name("Queue")) {
        if (!queue.includes(stringify(value))) {
          log(`Adding ${stringify(value)} to the queue...`);
          addToQueue(stringify(value));
        }

        cloud.set(cloud.name("Queue"), 0);
      }
    });

    while (true) {
      await new Promise(function (resolve, reject) {
        if (queue.length > 0) resolve();
        else {
          addToQueue = function (...a) {
            addToQueue = function (...a) {
              queue.push(...a);
            };
            addToQueue(...a);
            resolve();
          };
        }
      });

      const user = queue[0];
      const usercode = numerify(user);

      cloud.set(CurrentUser, usercode);

      let end;
      let currentAction;
      let gamedata = {};
      let gameid = null;

      function handle(name, value) {
        if (name !== Main) return;

        let command = stringify(value);
        let data = command.split(";");

        if (data[0] === "end") {
          end?.();
          return;
        }

        const key = stringify(data[1]);
        const val = data[2] ? stringify(data[2]) : "";

        let account = fs.existsSync(`./data/${usercode}/account`)
          ? loadJSON(`./data/${usercode}/account`, "utf-8")
          : {};

        if (data[0] === "get") {
          function respond(res) {
            const key = data[1];
            cloud.set(Main, numerify(`respond;${key};${numerify(res)}`));
          }

          log(`${user} made a get request for: ${key}`);

          if (key === "has account") {
            return respond(fs.existsSync(`./data/${usercode}/account`));
          } else if (/^data\//.test(key)) {
            return respond(gamedata[key.replace("data/", "")]);
          }
        } else if (data[0] === "set") {
          log(`${user} made a set request for: ${key}`);

          function received(res = "") {
            cloud.set(
              Main,
              numerify(
                `received;${numerify(
                  typeof res === "string" ? res : res.toString()
                )}`
              )
            );
          }

          if (key === "action") {
            currentAction = val;
            if (currentAction === "create account") {
              account = {
                username: user
              };
              fs.mkdirSync(`./data/${usercode}`);
              writeJSON(`./data/${usercode}/account`, account);
              fs.mkdirSync(`./data/${usercode}/games`);
              writeJSON(`./data/${usercode}/games/played`, []);
              return received();
            } else if (currentAction === "log in") {
              account = loadJSON(`./data/${usercode}/account`, "utf-8");
              return received();
            } else if (currentAction === "delete game") {
              if (fs.existsSync(`./data/${usercode}/games/${gameid}`)) {
                fs.unlinkSync(`./data/${usercode}/games/${gameid}`);
              }
            }
          } else if (key === "password") {
            if (currentAction === "create account") {
              account.password = val;
              writeJSON(`./data/${usercode}/account`, account);
              return received();
            } else if (currentAction === "log in") {
              if (val === account.password) {
                return received(true);
              } else {
                return received(false);
              }
            }
          } else if (key === "game") {
            gameid = val;
            let playedgames = loadJSON(`./data/${usercode}/games/played`);
            if (playedgames.includes(gameid)) {
              gamedata = loadJSON(`./data/${usercode}/games/${gameid}`);
              return received(true);
            } else {
              gamedata = {};
              writeJSON(`./data/${usercode}/games/${gameid}`, gamedata);
              playedgames.push(gameid);
              writeJSON(`./data/${usercode}/games/played`, playedgames);
              return received(false);
            }
          } else if (/^data\//.test(key)) {
            gamedata[key.replace("data/", "")] = val;
            writeJSON(`./data/${usercode}/games/${gameid}`, gamedata);
            return received();
          }
        } else if (data[0] === "delete") {
          function respond(res) {
            const key = data[1];
            cloud.set(Main, numerify(`respond;${key};${numerify(res)}`));
          }

          delete gamedata[key];
          writeJSON(`./data/${usercode}/games/${gameid}`, gamedata);

          return respond();
        }

        function loadJSON(file) {
          return JSON.parse(expand(fs.readFileSync(file, "utf-8")));
        }

        function writeJSON(file, data) {
          return fs.writeFileSync(file, compress(JSON.stringify(data)));
        }
      }

      await new Promise(function (resolve, reject) {
        end = function () {
          cloud.off("set", handle);
          resolve();
        };
        cloud.on("set", handle);
      });

      log(`Done serving user ${user}`);
      queue.shift();
    }
  }
}

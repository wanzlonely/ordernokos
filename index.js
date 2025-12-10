require('dotenv').config();

const { spawn } = require('child_process');
const path = require('path');
const figlet = require('figlet');
const os = require('os');

function getSystemStats() {
  return {
    memory: {
      total: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + 'GB',
      free: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + 'GB',
      usage: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(2) + '%'
    },
    cpu: os.cpus()[0].model,
    uptime: (os.uptime() / 3600).toFixed(2) + ' hours',
    platform: os.platform()
  };
}

async function displayHeader() {
  const chalk = (await import('chalk')).default; 
  console.clear();

  const title = figlet.textSync('Qoupay Store', {
    font: 'Ghost',
    horizontalLayout: 'full',
    verticalLayout: 'default',
    kerning: 'full'
  });

  const titleColored = title
    .split('\n')
    .map((line) => chalk.hex('#00C4CC')(line))
    .join('\n');
  console.log(titleColored);

  const stats = getSystemStats();
  const version = '2.0.0';

  const borderTop = chalk.bold.hex('#00C4CC')('╔' + '═'.repeat(78) + '╗');
  const borderBottom = chalk.bold.hex('#00C4CC')('╚' + '═'.repeat(78) + '╝');
  const borderSide = chalk.bold.hex('#00C4CC')('║');

  const pad = (s) => s.padEnd(76);

  const info = [
    `${borderSide} ${chalk.bold.hex('#F5A623')(pad('Qoupay Store - Developer Indonesia 2025'))} ${borderSide}`,
    `${borderSide} ${pad('')} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('📦 Version:    ') + chalk.bold.hex('#FF4E50')(version))} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('🧠 CPU:       ') + chalk.hex('#00C4CC')(stats.cpu.split('@')[0].trim()))} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('💾 Memory:    ') + chalk.hex('#8E2DE2')(`${stats.memory.usage} of ${stats.memory.total}`))} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('🌐 Platform:  ') + chalk.hex('#F5A623')(stats.platform))} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('⏱️ Uptime:    ') + chalk.hex('#00C4CC')(stats.uptime))} ${borderSide}`,
    `${borderSide} ${pad('')} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('👨‍💻 Creator:   ') + chalk.bold.hex('#FF4E50')('Requime'))} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('🔗 GitHub:    ') + chalk.underline.hex('#00C4CC')('https://github.com/ACTVTEAM'))} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('🎥 YouTube:   ') + chalk.underline.hex('#FF0000')('https://youtube.com/-'))} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('📱 Telegram:  ') + chalk.underline.hex('#0088CC')('https://t.me/qoupayind'))} ${borderSide}`,
    `${borderSide} ${pad(chalk.white('💼 Title:     ') + chalk.hex('#F5A623')('Developer 2025'))} ${borderSide}`,
    `${borderSide} ${pad('')} ${borderSide}`,
    `${borderSide} ${pad(
      chalk.bold.hex('#FF4E50')('⏰ Started:   ') +
      chalk.bold.hex('#00C4CC')(
        new Date().toLocaleString('en-US', {
          timeZone: 'Asia/Jakarta',
          hour12: true,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      )
    )} ${borderSide}`,
    `${borderSide} ${pad(chalk.bold.hex('#F5A623')('📢 Status:    Initializing AI subsystems...'))} ${borderSide}`
  ];

  console.log(borderTop);
  for (const line of info) {
    console.log(line);
    await new Promise((r) => setTimeout(r, 30));
  }
  console.log(borderBottom);

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  await new Promise((resolve) => {
    const id = setInterval(() => {
      process.stdout.write(
        `\r${chalk.bgHex('#00C4CC').black.bold(` ${frames[i]} STATUS: INITIALIZING `)}${chalk.hex('#FF4E50')(' ▶ ')}`
      );
      i = (i + 1) % frames.length;
    }, 100);
    setTimeout(() => {
      clearInterval(id);
      process.stdout.write('\n');
      resolve();
    }, 1000);
  });
}

(async () => {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  const chalk = (await import('chalk')).default;

  if (major < 20) {
    console.clear();
    const separator = chalk.bold.hex('#FF4E50')('═'.repeat(70));
    const errorTitle = chalk.bold.hex('#FF0000')(figlet.textSync('ERROR', { font: 'Small' }));
    console.log(separator);
    console.log(errorTitle);
    console.log();
    console.log(chalk.white('This application requires ') + chalk.bold.hex('#00C4CC')('Node.js 20+') + chalk.white(' to run optimally.'));
    console.log(chalk.white('Current version installed: ') + chalk.bold.hex('#FF4E50')(process.versions.node));
    console.log(separator);
    process.exit(1);
  }

  await displayHeader();
  console.log(chalk.bold.hex('#00C4CC')('\n✅ Initialization complete. Starting Qoupay Store Bot...\n'));

  // ==========================
  // 🔥 HOT RELOAD / AUTO UPDATE
  // ==========================
  const chokidar = (await import('chokidar')).default;
  const ENTRY = path.join(__dirname, 'client.js');

  let child = null;
  let restarting = false;
  let restartTimer = null;

  const VALID_EXT = new Set(['.js', '.mjs', '.cjs']); // hanya file JS yang trigger reload
  const IGNORED = [
    /node_modules/,
    /\.git/,
    /backup-.*\.zip$/,
    /Database\/Trx\/.*\.txt$/,
    /Database\/QR/,
    /Database\/.*\.json$/,   // ⬅️ opsional: abaikan semua JSON di Database
    /\.log$/,
    /(^|\/)\./
  ];

  function startChild() {
    child = spawn(process.argv[0], [ENTRY, ...process.argv.slice(2)], { stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      // Kalau kita sedang restart, biarkan startChild() yang baru yang aktif
      if (!restarting) process.exit(code ?? 0);
    });
    console.log(chalk.hex('#00C4CC')('▶ Bot started.'));
  }

  function stopChild() {
    return new Promise((resolve) => {
      if (!child || child.killed) return resolve();
      const killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        resolve();
      }, 2500);

      child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });

      try { child.kill('SIGTERM'); } catch { try { child.kill(); } catch {} }
    });
  }

  async function scheduleRestart(reason, filePath) {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(async () => {
      if (restarting) return;
      restarting = true;

      const nicePath = filePath ? path.relative(__dirname, filePath) : '(multiple files)';
      console.log(
        chalk.hex('#F5A623')(`\n♻ Reload triggered`) +
        chalk.white(` — ${reason} → `) +
        chalk.bold.hex('#00C4CC')(nicePath)
      );

      await stopChild();
      startChild();
      restarting = false;
    }, 400); // debounce 400ms supaya nggak spam restart saat banyak file berubah
  }

  // Mulai pertama kali
  startChild();

  const toPosix = (p) => p.replace(/\\/g, '/');                     // Windows -> POSIX
  const isJsFile = (p) => VALID_EXT.has(path.extname(p).toLowerCase());
  const shouldReload = (p) => isJsFile(p);                          // bisa tambah rule lain kalau perlu

  // Watch seluruh project folder (kecuali yang di-ignore)
  const watcher = chokidar.watch(__dirname, {
    ignored: IGNORED,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  });

  watcher
    .on('add', (p) => {
      const fp = toPosix(p);
      if (shouldReload(fp)) scheduleRestart('file added', fp);
      // else: diabaikan (mis. .json, .env, dll)
    })
    .on('change', (p) => {
      const fp = toPosix(p);
      if (shouldReload(fp)) scheduleRestart('file changed', fp);
    })
    .on('unlink', (p) => {
      const fp = toPosix(p);
      if (shouldReload(fp)) scheduleRestart('file removed', fp);
    });

  // Graceful shutdown (CTRL+C / kill)
  const shutdown = async (sig) => {
    console.log(chalk.hex('#FF4E50')(`\n${sig} received. Shutting down...`));
    try { await watcher.close(); } catch {}
    await stopChild();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
})();

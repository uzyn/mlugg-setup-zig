const os = require('os');
const fs = require('fs');
const path = require('path');
const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');

const VERSIONS_JSON = 'https://ziglang.org/download/index.json';
const MACH_VERSIONS_JSON = 'https://pkg.machengine.org/zig/index.json';
const CACHE_PREFIX = "setup-zig-global-cache-";

const MINIMUM_ZIG_VERSION_REGEX = /\.?\s*minimum_zig_version\s*=\s*"(.*?)"/;
console.log(`[DEBUG] Using regex pattern: ${MINIMUM_ZIG_VERSION_REGEX}`);

let _cached_version = null;
async function getVersion() {
  console.log(`[DEBUG] getVersion called, cached version: ${_cached_version}`);
  if (_cached_version != null) {
    console.log(`[DEBUG] Returning cached version: ${_cached_version}`);
    return _cached_version;
  }

  let raw = core.getInput('version');
  console.log(`[DEBUG] Input version: '${raw}'`);
  if (raw === '') {
    console.log(`[DEBUG] No explicit version provided, looking for build.zig.zon`);
    try {
      const zon = await fs.promises.readFile('build.zig.zon', 'utf8');
      console.log(`[DEBUG] build.zig.zon found. Content length: ${zon.length} bytes`);
      console.log(`[DEBUG] First 100 chars of build.zig.zon: ${zon.substring(0, 100)}...`);
      
      const match = MINIMUM_ZIG_VERSION_REGEX.exec(zon);
      console.log(`[DEBUG] Regex match result: ${match !== null ? 'Match found' : 'No match'}`);

      if (match !== null) {
        console.log(`[DEBUG] Matched version: '${match[1]}'`);
        _cached_version = match[1];
        return _cached_version;
      }

      console.log(`[DEBUG] Trying to manually find 'minimum_zig_version' in build.zig.zon`);
      const minimumZigIndex = zon.indexOf('minimum_zig_version');
      if (minimumZigIndex !== -1) {
        console.log(`[DEBUG] 'minimum_zig_version' found at index ${minimumZigIndex}`);
        console.log(`[DEBUG] Context around 'minimum_zig_version': ${zon.substring(Math.max(0, minimumZigIndex - 10), minimumZigIndex + 50)}`);
      } else {
        console.log(`[DEBUG] 'minimum_zig_version' not found in build.zig.zon`);
      }

      core.info('Failed to find minimum_zig_version in build.zig.zon (using latest)');
    } catch (e) {
      console.log(`[DEBUG] Error reading build.zig.zon: ${e}`);
      core.info(`Failed to read build.zig.zon (using latest): ${e}`);
    }

    console.log(`[DEBUG] Defaulting to 'latest'`);
    raw = 'latest';
  }

  if (raw === 'master') {
    const resp = await fetch(VERSIONS_JSON);
    const versions = await resp.json();
    _cached_version = versions['master'].version;
  } else if (raw === 'latest') {
    const resp = await fetch(VERSIONS_JSON);
    const versions = await resp.json();
    let latest = null;
    let latest_major;
    let latest_minor;
    let latest_patch;
    for (const version in versions) {
      if (version === 'master') continue;
      const [major_str, minor_str, patch_str] = version.split('.')
      const major = Number(major_str);
      const minor = Number(minor_str);
      const patch = Number(patch_str);
      if (latest === null) {
        latest = version;
        latest_major = major;
        latest_minor = minor;
        latest_patch = patch;
        continue;
      }
      if (major > latest_major ||
          (major == latest_major && minor > latest_minor) ||
          (major == latest_major && minor == latest_minor && patch > latest_patch))
      {
        latest = version;
        latest_major = major;
        latest_minor = minor;
        latest_patch = patch;
      }
    }
    _cached_version = latest;
  } else if (raw.includes("mach")) {
    const resp = await fetch(MACH_VERSIONS_JSON);
    const versions = await resp.json();
    if (!(raw in versions)) {
      throw new Error(`Mach nominated version '${raw}' not found`);
    }
    _cached_version = versions[raw].version;
  } else {
    _cached_version = raw;
  }

  return _cached_version;
}

async function getTarballName() {
  const version = await getVersion();

  let arch = {
    arm:      'armv7a',
    arm64:    'aarch64',
    loong64:  'loongarch64',
    mips:     'mips',
    mipsel:   'mipsel',
    mips64:   'mips64',
    mips64el: 'mips64el',
    ppc64:    'powerpc64',
    riscv64:  'riscv64',
    s390x:    's390x',
    ia32:     'x86',
    x64:      'x86_64',
  }[os.arch()];

  // For some incomprehensible reason, Node.js's brain-damaged build system explicitly throws away
  // the knowledge that it is building for ppc64le, so os.arch() will identify it as ppc64 even on
  // little endian.
  if (arch === 'powerpc64' && os.endianness() === 'LE') {
    arch = 'powerpc64le';
  }

  const platform = {
    aix:     'aix',
    android: 'android',
    freebsd: 'freebsd',
    linux:   'linux',
    darwin:  'macos',
    openbsd: 'openbsd',
    sunos:   'solaris',
    win32:   'windows',
  }[os.platform()];

  return `zig-${platform}-${arch}-${version}`;
}

async function getTarballExt() {
  return {
    linux:  '.tar.xz',
    darwin: '.tar.xz',
    win32:  '.zip',
  }[os.platform()];
}

async function getCachePrefix() {
  const tarball_name = await getTarballName();
  const job_name = github.context.job.replaceAll(/[^\w]/g, "_");
  return `setup-zig-cache-${job_name}-${tarball_name}-`;
}

async function getZigCachePath() {
  let env_output = '';
  await exec.exec('zig', ['env'], {
    listeners: {
      stdout: (data) => {
        env_output += data.toString();
      },
    },
  });
  return JSON.parse(env_output)['global_cache_dir'];
}

async function getTarballCachePath() {
  return path.join(process.env['RUNNER_TEMP'], await getTarballName());
}

module.exports = {
  getVersion,
  getTarballName,
  getTarballExt,
  getCachePrefix,
  getZigCachePath,
  getTarballCachePath,
  // Expose _cached_version for testing
  get _cached_version() { return _cached_version; },
  set _cached_version(val) { _cached_version = val; }
};

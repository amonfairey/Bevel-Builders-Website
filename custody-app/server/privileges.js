// Run as an unprivileged user even when the container has to start as root.
//
// Fly.io volumes and Render disks are fresh filesystems mounted root-owned, so a process that starts as a
// non-root user cannot create the database on them. The Docker image therefore starts as root, and this
// runs first, before the database is opened or a port is bound: it hands the data directory to RUN_AS_USER
// and permanently switches the process to that user (uid, gid and supplementary groups).
// It does nothing when the process is not root or RUN_AS_USER is unset (local development, `docker run --user`).
import { lchownSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function lookupUser(user) {
  for (const line of readFileSync('/etc/passwd', 'utf8').split('\n')) {
    const [name, , uid, gid] = line.split(':');
    if (name === user || uid === String(user)) return { name, uid: +uid, gid: +gid };
  }
  throw new Error(`RUN_AS_USER "${user}" is not in /etc/passwd`);
}

function chownTree(path, uid, gid) {
  const st = lstatSync(path);
  if (st.uid !== uid || st.gid !== gid) lchownSync(path, uid, gid);
  if (st.isDirectory()) for (const f of readdirSync(path)) chownTree(join(path, f), uid, gid);
}

/** Returns true if the process switched user. Throws (and the process should exit) if it can't. */
export function dropPrivileges(dataDir, user = process.env.RUN_AS_USER) {
  if (!user || typeof process.getuid !== 'function' || process.getuid() !== 0) return false;
  const u = lookupUser(user);
  if (u.uid === 0) return false;
  if (dataDir) { mkdirSync(dataDir, { recursive: true }); chownTree(dataDir, u.uid, u.gid); }
  process.initgroups(u.name, u.gid);
  process.setgid(u.gid);
  process.setuid(u.uid);
  if (process.getuid() !== u.uid || process.geteuid() !== u.uid) throw new Error('Could not switch user');
  return true;
}

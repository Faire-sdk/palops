import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { badRequest } from '../../utils/errors.js';

/** Only ordinary log files are read, so a path typo can't expose something like a .env file. */
export const LOG_EXTENSIONS = new Set(['.log', '.txt', '.out']);

export interface CheckedPath {
  /** The real path, with symlinks resolved. */
  path: string;
  kind: 'file' | 'directory';
}

const isInside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * Checks a configured log location: absolute, existing, a log file or a folder,
 * and never inside the panel's own data (database, secrets).
 */
export function checkLogPath(raw: string, protectedDirs: string[]): CheckedPath {
  const value = raw.trim();
  if (!value) throw badRequest('Enter a path', 'invalid_path');
  if (value.includes('\0')) throw badRequest('That path is not valid', 'invalid_path');
  if (!isAbsolute(value)) throw badRequest('Use a full path, such as C:\\PalServer\\Pal\\Saved\\Logs or /srv/palworld/Pal/Saved/Logs', 'invalid_path');
  if (!existsSync(value)) throw badRequest('That path doesn’t exist on the machine PalOps runs on. If PalOps runs in a container, mount the log folder into it.', 'path_not_found');
  const real = realpathSync(resolve(value));
  const info = statSync(real);
  for (const dir of protectedDirs) {
    const protectedReal = existsSync(dir) ? realpathSync(dir) : resolve(dir);
    if (isInside(protectedReal, real) || isInside(real, protectedReal)) {
      throw badRequest('That location holds PalOps’s own data, so it can’t be shown in the console', 'protected_path');
    }
  }
  if (info.isDirectory()) return { path: real, kind: 'directory' };
  if (!info.isFile()) throw badRequest('That isn’t a file or folder', 'invalid_path');
  if (!LOG_EXTENSIONS.has(extname(real).toLowerCase())) {
    throw badRequest(`Only ${[...LOG_EXTENSIONS].join(', ')} files can be tailed. Point at the log folder instead, or at a file with one of those extensions.`, 'invalid_path');
  }
  if (basename(real).startsWith('.')) throw badRequest('Hidden files can’t be tailed', 'invalid_path');
  return { path: real, kind: 'file' };
}


import crypto from 'node:crypto';

/**
 * Constant-time string comparison using SHA-256 to prevent timing attacks.
 */
export function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Usuarios de la casa: "Nombre:clave,Nombre2:clave2".
 * Si el nombre coincide con una habitación (ej. "Mariana" -> mariana) es su dueño;
 * el resto (ej. Amelia) es familia. Todos pueden entrar a cualquier pieza y
 * agregar cosas; el servidor guarda quién lo agregó.
 */
export function parseUsers(raw = '', rooms = []) {
  const byName = new Map(rooms.map((r) => [String(r.name).toLowerCase(), r.id]));
  const familyList = [];
  const ownerList = [];
  const readonlyList = [];
  const clean = (raw || '').replace(/^["']|["']$/g, '').trim();
  for (const pair of clean.split(',')) {
    let entry = pair.trim();
    let isReadonly = false;
    if (/:readonly$/i.test(entry)) {
      isReadonly = true;
      entry = entry.replace(/:readonly$/i, '').trim();
    }
    const idx = entry.indexOf(':');
    if (idx === -1) continue;
    const name = entry.slice(0, idx).trim();
    const code = entry.slice(idx + 1).trim();
    if (!name || !code) continue;
    const roomId = byName.get(name.toLowerCase());
    if (isReadonly) readonlyList.push({ name, code });
    else if (roomId) ownerList.push({ roomId, name, code });
    else familyList.push({ name, code });
  }
  return { familyList, ownerList, readonlyList };
}

/**
 * Validates a passcode and returns user credentials or null.
 */
export function verifyPasscode(passcode, { familyList = [], ownerList = [], readonlyList = [] } = {}) {
  if (!passcode || typeof passcode !== 'string') return null;
  const trimmed = passcode.trim();
  if (!trimmed) return null;

  // Check owner passcodes first
  for (const o of ownerList) {
    if (timingSafeEqualStrings(trimmed, o.code)) {
      return {
        name: o.name,
        role: 'owner',
        roomId: o.roomId
      };
    }
  }

  // Check family passcodes
  for (const f of familyList) {
    if (timingSafeEqualStrings(trimmed, f.code)) {
      return {
        name: f.name,
        role: 'familia'
      };
    }
  }

  // Check read-only passcodes
  for (const r of readonlyList) {
    if (timingSafeEqualStrings(trimmed, r.code)) {
      return {
        name: r.name,
        role: 'readonly'
      };
    }
  }

  return null;
}

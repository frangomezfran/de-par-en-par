/**
 * Sesión de la casa: se abre al tocar la primera puerta y dura hasta cerrar la
 * pestaña (sessionStorage). Guarda el nombre y la clave para firmar comentarios
 * y agregar cosas sin volver a pedirla.
 */
import { useSyncExternalStore } from 'react';
import { checkPasscode } from './api.js';

const KEY = 'amelia_session';
const listeners = new Set();

function read() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

let current = typeof sessionStorage !== 'undefined' ? read() : null;

function emit() {
  for (const l of listeners) l();
}

export function getSession() {
  return current;
}

/** Valida la clave contra el servidor y abre la sesión. Lanza Error si no es válida. */
export async function login(passcode) {
  const clean = String(passcode ?? '').trim().toLowerCase();
  const who = await checkPasscode(clean);
  current = { name: who.name, role: who.role, roomId: who.roomId ?? null, passcode: clean };
  sessionStorage.setItem(KEY, JSON.stringify(current));
  emit();
  return current;
}

export function logout() {
  current = null;
  sessionStorage.removeItem(KEY);
  emit();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @returns {{ name: string, role: string, roomId: string|null, passcode: string } | null} */
export default function useSession() {
  return useSyncExternalStore(subscribe, getSession, () => null);
}

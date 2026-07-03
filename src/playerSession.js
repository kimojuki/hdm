import { PlayerBase } from './playerBase.js';

const SESSION_STORAGE_KEY = 'hdm_player_id';

function createUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Identifiant persistant du joueur local (préparation multi-joueur / sauvegarde). */
export function getOrCreatePlayerId() {
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    // localStorage indisponible (mode privé, etc.)
  }

  const id = `player_${createUuid()}`;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // ignore
  }
  return id;
}

/**
 * Session joueur : possède une Base personnelle isolée.
 * À terme : données de progression, équipement, invitations, etc.
 */
export class PlayerSession {
  constructor(playerId = getOrCreatePlayerId()) {
    this.playerId = playerId;
    this.base = new PlayerBase(playerId);
    this.connected = false;
  }

  async connect(loadOptions = {}) {
    if (!this.base.loaded) {
      await this.base.load(loadOptions);
    }
    this.connected = true;
    return this.base;
  }

  disconnect() {
    this.connected = false;
  }
}

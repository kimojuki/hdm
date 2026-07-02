import { PlayerBase } from './playerBase.js';

const SESSION_STORAGE_KEY = 'hdm_player_id';

/** Identifiant persistant du joueur local (préparation multi-joueur / sauvegarde). */
export function getOrCreatePlayerId() {
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    // localStorage indisponible (mode privé, etc.)
  }

  const id = `player_${crypto.randomUUID()}`;
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

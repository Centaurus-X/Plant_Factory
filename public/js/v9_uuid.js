/**
 * v9_uuid.js — deterministische controller_uuid-Ableitung (RFC 4122 UUIDv5).
 *
 * Der V9-Vertrag verlangt für jeden Controller eine global stabile
 * `controller_uuid`. Damit derselbe Controller in Editor, Master und Worker
 * dieselbe Identität bekommt, wird sie deterministisch abgeleitet statt
 * zufällig erzeugt.
 *
 * VERBINDLICHE KONVENTION (aus der Runtime-Baseline rückgerechnet und gegen
 * ALLE fünf Bestands-UUIDs in device_state_data_v9_node_fn-01.json,
 * device_state_data_v8_cross_fn-01.json und dem fn-02-Shard verifiziert):
 *
 *   controller_uuid = uuid5(NAMESPACE_DNS, "<site_id>.<mint_node_id>.<device_name>")
 *
 * Drei Feinheiten, die den Unterschied zwischen "sieht richtig aus" und
 * "die Runtime findet den Controller" ausmachen:
 *
 *   1. Namespace ist NAMESPACE_DNS — nicht ein eigener Automation-Namespace.
 *   2. Getrennt wird mit PUNKT, nicht mit Schrägstrich.
 *   3. Es zählt der `device_name` (`wago_1`), NICHT der `controller_key`
 *      (`ctrl_wago_1`). `deviceNameFor()` nimmt beide Schreibweisen an.
 *
 * Die Identität ist eine PROVISIONIERUNGS-Identität: sie wird einmal beim
 * Einrichten geprägt und bleibt danach stabil, auch wenn der Controller auf
 * einen anderen Node umzieht. Genau das zeigt `wago_5` — geprägt unter
 * `site_main.fn-01.wago_5`, betrieben aber auf fn-02. Deshalb gibt es
 * `options.mintNodeId`: der Betriebsnode darf wechseln, die Identität nicht.
 *
 * Identisch implementiert in _tools/migrate_config_to_v9.py — beide Seiten
 * erzeugen bitgleiche UUIDs (Regressionstest: test/test_v9_core.mjs).
 *
 * Die alte Editor-Konvention (V52/V53) bleibt als `legacyControllerUuidFor()`
 * erhalten — ausschließlich, um vom Editor selbst geprägte Altbestände zu
 * ERKENNEN und auf die Runtime-Konvention umzuschreiben.
 *
 * Eigenes SHA-1: SubtleCrypto ist asynchron und nur in Secure Contexts
 * verfügbar; die Factories brauchen die UUID synchron.
 *
 * Stil: rein funktional, kein OOP.
 */

'use strict';

export const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
export const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** Site, unter der die Bestandsflotte geprägt wurde (steckt in jeder UUID). */
export const MINT_SITE_ID = 'site_main';

/** Node, unter dem die Bestandsflotte geprägt wurde. */
export const MINT_NODE_ID = 'fn-01';

/**
 * Bestands-UUIDs der Runtime-Baseline, nach `device_name` geschlüsselt.
 * Sie sind KEIN Sonderweg mehr, sondern eine Prüftabelle: jede dieser UUIDs
 * lässt sich mit `controllerUuidFor(MINT_SITE_ID, MINT_NODE_ID, name)`
 * reproduzieren (siehe test/test_v9_core.mjs).
 */
export const PINNED_CONTROLLER_UUIDS = Object.freeze({
  wago_1: 'cded47f3-4dc5-5439-9aa6-73f0fff5e335',
  wago_2: '62671112-766c-59ed-b0ff-30a49d48f747',
  wago_3: 'd11032fa-33db-56de-a4ed-7e16cca3ded7',
  wago_4: '82fb9eb0-3fd9-5db5-a04e-7f06e405cfdf',
  wago_5: '06ab4528-f8a3-5ec7-a91f-eea79d60761e'
});

/* ---------------------------------------------------------------------- */
/* SHA-1 (RFC 3174) auf Byte-Arrays                                        */
/* ---------------------------------------------------------------------- */

function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function sha1(bytes) {
  const message = Array.prototype.slice.call(bytes);
  const bitLength = message.length * 8;

  message.push(0x80);
  while (message.length % 64 !== 56) message.push(0x00);
  // 64-Bit-Länge, big endian. Längen > 2^32 Bit kommen hier nicht vor.
  for (let i = 0; i < 4; i += 1) message.push(0x00);
  message.push((bitLength >>> 24) & 0xff);
  message.push((bitLength >>> 16) & 0xff);
  message.push((bitLength >>> 8) & 0xff);
  message.push(bitLength & 0xff);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const words = new Array(80);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = ((message[offset + i * 4] << 24)
        | (message[offset + i * 4 + 1] << 16)
        | (message[offset + i * 4 + 2] << 8)
        | message[offset + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i += 1) {
      words[i] = rotateLeft(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let mixed;
      let constant;
      if (i < 20) {
        mixed = (b & c) | (~b & d);
        constant = 0x5a827999;
      } else if (i < 40) {
        mixed = b ^ c ^ d;
        constant = 0x6ed9eba1;
      } else if (i < 60) {
        mixed = (b & c) | (b & d) | (c & d);
        constant = 0x8f1bbcdc;
      } else {
        mixed = b ^ c ^ d;
        constant = 0xca62c1d6;
      }
      const temp = (rotateLeft(a, 5) + (mixed >>> 0) + e + constant + words[i]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = [];
  [h0, h1, h2, h3, h4].forEach(function (word) {
    out.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  });
  return out;
}

/* ---------------------------------------------------------------------- */
/* UUID-Kodierung                                                          */
/* ---------------------------------------------------------------------- */

function utf8Bytes(text) {
  const out = [];
  const encoded = unescape(encodeURIComponent(String(text)));
  for (let i = 0; i < encoded.length; i += 1) out.push(encoded.charCodeAt(i) & 0xff);
  return out;
}

function uuidToBytes(uuid) {
  const hex = String(uuid).replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 32) throw new Error('Ungültige UUID: ' + uuid);
  const out = [];
  for (let i = 0; i < 32; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  return out;
}

function bytesToUuid(bytes) {
  const hex = bytes.map(function (byte) {
    return (byte + 0x100).toString(16).slice(1);
  }).join('');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32)
  ].join('-');
}

/** RFC-4122-konforme UUIDv5 (SHA-1, namensbasiert). */
export function uuid5(namespace, name) {
  const digest = sha1(uuidToBytes(namespace).concat(utf8Bytes(name))).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50; // Version 5
  digest[8] = (digest[8] & 0x3f) | 0x80; // Variante RFC 4122
  return bytesToUuid(digest);
}

/* ---------------------------------------------------------------------- */
/* SHA-256 (FIPS 180-4) auf UTF-8-Text                                     */
/*                                                                          */
/* Aus demselben Grund selbst gebaut wie das SHA-1 oben: `crypto.subtle` ist */
/* asynchron und nur in Secure Contexts verfügbar. Ein Snapshot muss sich    */
/* aber auch dann prüfen lassen, wenn das SVG per `file://` geöffnet wurde —  */
/* also genau in dem Fall, für den ein Notfall-Snapshot gedacht ist.         */
/* ---------------------------------------------------------------------- */

const SHA256_K = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr32(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** SHA-256 als Hex-String. Synchron, ohne SubtleCrypto. */
export function sha256Hex(text) {
  const bytes = Array.isArray(text) ? text.slice() : utf8Bytes(text);
  const bitLength = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // Länge als 64-Bit-Big-Endian. Die oberen 32 Bit bleiben praktisch immer 0;
  // sie werden trotzdem korrekt gefüllt, damit auch >512 MB stimmen.
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff);
  bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);

  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Array(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      words[i] = ((bytes[at] << 24) | (bytes[at + 1] << 16)
        | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotr32(words[i - 15], 7) ^ rotr32(words[i - 15], 18)
        ^ (words[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr32(words[i - 2], 17) ^ rotr32(words[i - 2], 19)
        ^ (words[i - 2] >>> 10)) >>> 0;
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[i] + words[i]) >>> 0;
      const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map(function (word) {
    return ('00000000' + word.toString(16)).slice(-8);
  }).join('');
}

/** Wurzel-Namespace des Automationssystems. */
export const NS_AUTOMATION = uuid5(NAMESPACE_URL, 'urn:automation:controller');

/** Prüft, ob ein String eine syntaktisch gültige UUID ist. */
export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

/**
 * Gerätename aus `device_name` ODER `controller_key`.
 * `ctrl_wago_1` und `wago_1` führen zur selben Identität — der Aufrufer muss
 * sich nicht merken, welche der beiden Schreibweisen er gerade in der Hand hat.
 */
export function deviceNameFor(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
    .replace(/\s+/g, '_');
  if (!text) return 'controller';
  return text.indexOf('ctrl_') === 0 ? text.slice(5) || 'controller' : text;
}

/**
 * Deterministische Controller-Identität nach Runtime-Konvention.
 *
 * @param {string} siteId       Site der Prägung (Bestand: 'site_main').
 * @param {string} nodeId       Betriebs-Node.
 * @param {string} nameOrKey    `device_name` oder `controller_key`.
 * @param {object} [options]    `mintNodeId` überschreibt den Prägungs-Node
 *                              (Controller, der den Node gewechselt hat).
 */
export function controllerUuidFor(siteId, nodeId, nameOrKey, options) {
  const name = deviceNameFor(nameOrKey);
  const mintNode = (options && options.mintNodeId) || nodeId;
  return uuid5(NAMESPACE_DNS, siteId + '.' + mintNode + '.' + name);
}

/**
 * Alte Editor-Konvention aus V52/V53. NUR zum Erkennen von Altbeständen —
 * niemals zum Prägen neuer Identitäten.
 */
export function legacyControllerUuidFor(siteId, nodeId, controllerKey) {
  return uuid5(NS_AUTOMATION, siteId + '/' + nodeId + '/' + controllerKey);
}

/** Meldet, ob eine UUID noch nach der alten Editor-Konvention geprägt wurde. */
export function isLegacyControllerUuid(value, siteId, nodeId, nameOrKey) {
  const name = deviceNameFor(nameOrKey);
  return String(value || '') === legacyControllerUuidFor(siteId, nodeId, 'ctrl_' + name);
}

/** controller_key aus dem Gerätenamen (stabile Konvention). */
export function controllerKeyFor(deviceName) {
  return 'ctrl_' + deviceNameFor(deviceName);
}

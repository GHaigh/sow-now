#!/usr/bin/env node
/**
 * Sow Now — Node key generator
 *
 * Generates a random AES-128 key, formats it for:
 *   - C array (for provision_node.ino)
 *   - Hex string (for Pi agent config and Cloudflare D1 storage)
 *   - avrdude .eep Intel HEX EEPROM image
 *
 * Usage:
 *   node scripts/gen_node_key.mjs --id 0x01 --type 0x01
 *
 * Output format:
 *   NODE_ID:   0x01
 *   NODE_TYPE: 0x01
 *   AES_KEY:   aabbcc...
 *   C_ARRAY:   0xAA,0xBB,...
 *   EEP_FILE:  node_0x01.eep (written to ./scripts/output/)
 *
 * The .eep file can be flashed directly:
 *   avrdude -c usbasp -p t85 -U eeprom:w:node_0x01.eep:i
 */

import { randomBytes } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// Parse CLI args
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? parseInt(args[i + 1], 16) : null;
};

const nodeId   = get('--id')   ?? 0x01;
const nodeType = get('--type') ?? 0x01;

// Generate key
const key = randomBytes(16);

// ── EEPROM layout (must match config.h) ──────────────────────────────────────
// Addr 0: magic byte 0 (0xB0)
// Addr 1: magic byte 1 (0xBE)
// Addr 2: node_id
// Addr 3: node_type
// Addr 4-19: AES key (16 bytes)
// Addr 20-21: moisture_dry (0xFF,0xFF = use default)
// Addr 22-23: moisture_wet (0xFF,0xFF = use default)

const eeprom = Buffer.alloc(512, 0xFF); // ATtiny85 EEPROM = 512 bytes
eeprom[0] = 0xB0;
eeprom[1] = 0xBE;
eeprom[2] = nodeId;
eeprom[3] = nodeType;
key.copy(eeprom, 4);
// Moisture addresses left as 0xFF (use firmware defaults)

// Convert to Intel HEX format
function toIntelHex(buf) {
  const lines = [];
  const PAGE = 16;
  for (let addr = 0; addr < buf.length; addr += PAGE) {
    const chunk = buf.slice(addr, Math.min(addr + PAGE, buf.length));
    let checksum = chunk.length + (addr >> 8) + (addr & 0xFF);
    let hex = '';
    for (const b of chunk) { hex += b.toString(16).padStart(2, '0').toUpperCase(); checksum += b; }
    checksum = ((~checksum) + 1) & 0xFF;
    lines.push(`:${chunk.length.toString(16).padStart(2,'0').toUpperCase()}${addr.toString(16).padStart(4,'0').toUpperCase()}00${hex}${checksum.toString(16).padStart(2,'0').toUpperCase()}`);
  }
  lines.push(':00000001FF'); // EOF record
  return lines.join('\n');
}

const hexContent = toIntelHex(eeprom);
const nodeHex    = `0x${nodeId.toString(16).padStart(2, '0')}`;
const fileName   = `node_${nodeHex}.eep`;
const outDir     = join(__dir, 'output');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, fileName), hexContent);

// ── Print summary ─────────────────────────────────────────────────────────────
const keyHex = key.toString('hex');
const cArray = Array.from(key).map(b => `0x${b.toString(16).padStart(2,'0').toUpperCase()}`).join(', ');

console.log(`NODE_ID:   ${nodeHex}`);
console.log(`NODE_TYPE: 0x${nodeType.toString(16).padStart(2,'0')}`);
console.log(`AES_KEY:   ${keyHex}`);
console.log(`C_ARRAY:   { ${cArray} }`);
console.log(`EEP_FILE:  scripts/output/${fileName}`);
console.log('');
console.log('Flash command:');
console.log(`  avrdude -c usbasp -p t85 -U eeprom:w:scripts/output/${fileName}:i`);
console.log('');
console.log('Store AES_KEY in D1 against the device record:');
console.log(`  wrangler d1 execute vernal-db \\`);
console.log(`    --command "UPDATE devices SET lora_aes_key='${keyHex}' WHERE node_id=${nodeId}"`);

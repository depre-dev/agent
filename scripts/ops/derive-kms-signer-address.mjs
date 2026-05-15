#!/usr/bin/env node

/**
 * Phase 3 prep — derive the EVM address from an AWS KMS asymmetric key.
 *
 * The KMS signer's "address" is the keccak256 of its uncompressed
 * secp256k1 public key, last 20 bytes (per the EIP-55 / EIP-155 path
 * that every EVM signer uses). To get the public key we call
 * `kms:GetPublicKey`, which returns it as a DER-encoded
 * SubjectPublicKeyInfo (SPKI).
 *
 * Usage:
 *   AWS_REGION=eu-central-1 \
 *     node scripts/ops/derive-kms-signer-address.mjs <key-arn-or-id>
 *
 * Or, for offline testing against a captured fixture (no AWS creds
 * needed):
 *   node scripts/ops/derive-kms-signer-address.mjs --spki-file /tmp/captured.der
 *
 * Notes:
 *   - The SPKI structure for a secp256k1 EC key has a known shape, but
 *     the doc (docs/SECRETS_MIGRATION.md §3c) warns against slicing
 *     fixed offsets because the algorithm OID encoding can vary. We
 *     do a small hand-rolled ASN.1 walk and validate every length
 *     byte; any structural surprise fails loudly with a specific error.
 *   - `kms:GetPublicKey` does NOT require `kms:Sign` permission, so
 *     this script is safe to run against a key that the caller can
 *     only read.
 *
 * Exit codes:
 *   0  Address derived and printed.
 *   1  Bad input (missing key id, malformed SPKI, etc.).
 *   2  AWS error (auth, network, key not found).
 */

import { readFile } from "node:fs/promises";
import { computeAddress } from "ethers";

const HELP = `Usage:
  AWS_REGION=eu-central-1 node scripts/ops/derive-kms-signer-address.mjs <key-arn-or-id>
  node scripts/ops/derive-kms-signer-address.mjs --spki-file <path-to-der>

Flags:
  --spki-file <path>   Skip AWS; read SPKI bytes from a local DER file.
                       For offline test fixtures.
  --json               Emit JSON output {address, publicKeyHex, keyId}.
  --help, -h           This message.
`;

// ─── SPKI parsing ────────────────────────────────────────────────────

const OID_EC_PUBLIC_KEY = "1.2.840.10045.2.1";
const OID_SECP256K1 = "1.3.132.0.10";

/**
 * Parse a DER-encoded SubjectPublicKeyInfo for a secp256k1 public key
 * and return the 65-byte uncompressed point (0x04 || x || y).
 *
 * @param {Uint8Array} der  DER-encoded SPKI as returned by KMS GetPublicKey
 * @returns {Uint8Array}    65-byte uncompressed EC point
 */
export function parseSecp256k1Spki(der) {
  if (!(der instanceof Uint8Array)) {
    throw new TypeError("parseSecp256k1Spki expects a Uint8Array");
  }
  const buf = der;
  let off = 0;

  function readTagLen(expectedTag, label) {
    if (off >= buf.length) throw new Error(`${label}: truncated DER at byte ${off}`);
    const tag = buf[off++];
    if (tag !== expectedTag) {
      throw new Error(`${label}: expected DER tag 0x${expectedTag.toString(16)}, got 0x${tag.toString(16)} at byte ${off - 1}`);
    }
    if (off >= buf.length) throw new Error(`${label}: missing length byte`);
    let len = buf[off++];
    if (len & 0x80) {
      const nLen = len & 0x7f;
      if (nLen === 0 || nLen > 4) throw new Error(`${label}: unsupported length-of-length ${nLen}`);
      len = 0;
      for (let i = 0; i < nLen; i++) {
        if (off >= buf.length) throw new Error(`${label}: truncated multi-byte length`);
        len = (len << 8) | buf[off++];
      }
    }
    if (off + len > buf.length) throw new Error(`${label}: declared length ${len} overruns DER at byte ${off}`);
    return len;
  }

  function readOid(label) {
    const len = readTagLen(0x06, `${label} OID`);
    const bytes = buf.subarray(off, off + len);
    off += len;
    // Decode the OID using the standard "first two arcs packed into first
    // byte" rule: first = floor(b/40), second = b mod 40, then base-128.
    const arcs = [];
    arcs.push(Math.floor(bytes[0] / 40));
    arcs.push(bytes[0] % 40);
    let acc = 0;
    for (let i = 1; i < bytes.length; i++) {
      acc = (acc << 7) | (bytes[i] & 0x7f);
      if ((bytes[i] & 0x80) === 0) {
        arcs.push(acc);
        acc = 0;
      }
    }
    return arcs.join(".");
  }

  // SubjectPublicKeyInfo ::= SEQUENCE {
  //   algorithm        AlgorithmIdentifier,
  //   subjectPublicKey BIT STRING
  // }
  readTagLen(0x30, "SPKI outer SEQUENCE");

  // AlgorithmIdentifier ::= SEQUENCE {
  //   algorithm  OBJECT IDENTIFIER,
  //   parameters ANY OPTIONAL
  // }
  // NB: readTagLen has the side-effect of advancing `off` past the
  // tag+length bytes, so capture the length FIRST, then add it to the
  // (now-updated) `off`. Reading `off + readTagLen(...)` evaluates
  // `off` before the call — a stale value would land us 2 bytes short.
  const algIdContentLen = readTagLen(0x30, "AlgorithmIdentifier SEQUENCE");
  const algIdEnd = off + algIdContentLen;
  const algorithmOid = readOid("AlgorithmIdentifier.algorithm");
  if (algorithmOid !== OID_EC_PUBLIC_KEY) {
    throw new Error(`AlgorithmIdentifier.algorithm: expected ecPublicKey (${OID_EC_PUBLIC_KEY}), got ${algorithmOid}`);
  }
  // The curve OID is the parameters field, encoded inline as an OID.
  const curveOid = readOid("AlgorithmIdentifier.parameters (curve)");
  if (curveOid !== OID_SECP256K1) {
    throw new Error(`Curve OID: expected secp256k1 (${OID_SECP256K1}), got ${curveOid}. Did you create a key with the wrong KeySpec?`);
  }
  if (off !== algIdEnd) {
    throw new Error(`AlgorithmIdentifier has trailing bytes at ${off}, expected end at ${algIdEnd}`);
  }

  // BIT STRING. First content byte is the number of unused bits (always
  // 0 for byte-aligned values like EC public keys).
  const bitStrLen = readTagLen(0x03, "subjectPublicKey BIT STRING");
  if (bitStrLen < 2) throw new Error(`BIT STRING too short: ${bitStrLen}`);
  const unusedBits = buf[off++];
  if (unusedBits !== 0) {
    throw new Error(`BIT STRING unused bits should be 0 for EC public keys, got ${unusedBits}`);
  }
  const pointBytes = buf.subarray(off, off + bitStrLen - 1);
  off += bitStrLen - 1;

  // Expect uncompressed point: 0x04 || x (32) || y (32) = 65 bytes.
  if (pointBytes.length !== 65) {
    throw new Error(`Public key point: expected 65 bytes (0x04 || x32 || y32), got ${pointBytes.length}`);
  }
  if (pointBytes[0] !== 0x04) {
    throw new Error(`Public key point: expected uncompressed marker 0x04, got 0x${pointBytes[0].toString(16)}`);
  }
  return new Uint8Array(pointBytes); // copy out
}

/**
 * Compute the EVM address (0x-prefixed, EIP-55 checksum) for a 65-byte
 * uncompressed secp256k1 public key.
 *
 * @param {Uint8Array} point  65-byte uncompressed point
 * @returns {string}          0x-prefixed EIP-55-checksummed address
 */
export function addressFromUncompressedPoint(point) {
  // ethers v6 `computeAddress` accepts either a private key, a 33-byte
  // compressed pub key, or a 65-byte uncompressed pub key, all hex-encoded.
  // Hand it the hex form for clarity.
  const hex = "0x" + Buffer.from(point).toString("hex");
  return computeAddress(hex);
}

// ─── CLI ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--spki-file") {
      out.spkiFile = argv[++i];
    } else if (a === "--json") {
      out.json = true;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(HELP);
    process.exit(1);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  // Two paths: AWS (default) or fixture file (--spki-file).
  let der;
  let keyId = null;
  if (args.spkiFile) {
    try {
      der = new Uint8Array(await readFile(args.spkiFile));
    } catch (err) {
      console.error(`Could not read ${args.spkiFile}: ${err.message}`);
      process.exit(1);
    }
  } else {
    keyId = args.positional[0];
    if (!keyId) {
      console.error("Missing key id. Provide an AWS KMS key id/ARN or use --spki-file.");
      console.error(HELP);
      process.exit(1);
    }
    const region = process.env.AWS_REGION;
    if (!region) {
      console.error("AWS_REGION is required when fetching from KMS.");
      process.exit(1);
    }
    // Lazy-import the AWS SDK so the script also works in offline /
    // CI environments that haven't installed @aws-sdk/* yet.
    let KMSClient, GetPublicKeyCommand;
    try {
      ({ KMSClient, GetPublicKeyCommand } = await import("@aws-sdk/client-kms"));
    } catch (err) {
      console.error(`@aws-sdk/client-kms not installed: ${err.message}`);
      console.error("Run `npm install` at the repo root, or pass --spki-file for offline test.");
      process.exit(1);
    }
    const kms = new KMSClient({ region });
    try {
      const { PublicKey } = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
      if (!PublicKey) throw new Error("KMS returned empty PublicKey");
      der = new Uint8Array(PublicKey);
    } catch (err) {
      console.error(`KMS GetPublicKey failed: ${err.message}`);
      process.exit(2);
    }
  }

  let point, address;
  try {
    point = parseSecp256k1Spki(der);
    address = addressFromUncompressedPoint(point);
  } catch (err) {
    console.error(`Could not derive address: ${err.message}`);
    process.exit(1);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({
      address,
      publicKeyHex: "0x" + Buffer.from(point).toString("hex"),
      keyId
    }) + "\n");
  } else {
    console.log(`EVM address: ${address}`);
    console.log(`Public key:  0x${Buffer.from(point).toString("hex")}`);
    if (keyId) console.log(`KMS key id:  ${keyId}`);
  }
}

// Run only when invoked as a script (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

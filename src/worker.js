import { parentPort, workerData } from 'worker_threads';
import ordinals from 'micro-ordinals';
import { Transaction } from '@scure/btc-signer';
import { utf8 } from '@scure/base';

import parseEncryptedDescriptor from './parse.js';

async function processBlock(rawHex) {
  const hexToBytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
  const bytesToHex = (bytes) => Buffer.from(bytes).toString('hex');

  const readUInt32LE = (bytes, offset) => (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    (bytes[offset + 3] << 24)
  );

  const readVarInt = (bytes, offset) => {
    const firstByte = bytes[offset];
    if (firstByte < 0xfd) {
      return { value: firstByte, size: 1 };
    } else if (firstByte === 0xfd) {
      return { value: bytes[offset + 1] + (bytes[offset + 2] << 8), size: 3 };
    } else if (firstByte === 0xfe) {
      return { value: readUInt32LE(bytes, offset + 1), size: 5 };
    } else {
      throw new Error("64-bit varint not supported");
    }
  };

  const blockBytes = hexToBytes(rawHex);

  // Extract the prevBlockHash (bytes 4 to 36 in the header)
  const prevBlockhash = bytesToHex(blockBytes.subarray(4, 36)).match(/.{2}/g).reverse().join('');

  let offset = 80; // Skip the block header
  const { value: txCount, size: txCountSize } = readVarInt(blockBytes, offset);
  offset += txCountSize;

  const xfpPairs = {};

  for (let i = 0; i < txCount; i++) {
    const txStart = offset;
    const txSize = parseTransactionSize(blockBytes, offset);
    offset += txSize;

    try {
      const tx = Transaction.fromRaw(blockBytes.subarray(txStart, offset), { 
        allowUnknownOutputs: true,
        disableScriptCheck: true,
      })
      for (const input of tx.inputs) {
        try {
          const inscriptions = ordinals.parseWitness(input.finalScriptWitness);
          for (const [i, inscription] of inscriptions.entries()) {
            if (!inscription.tags.contentType?.startsWith('text/plain')) continue;
            const inscriptionId = `${tx.id}i${i}`;
            const text = utf8.encode(inscription.body);
            if (text.length < 100) continue;
            try {
              const result = parseEncryptedDescriptor(text);
              for (const xfpPairFingerprint of result.xfpPairFingerprints) {
                if (!xfpPairs[xfpPairFingerprint]) {
                  xfpPairs[xfpPairFingerprint] = [];
                }
                xfpPairs[xfpPairFingerprint].push(inscriptionId);
              }
            } catch {
              // Skip parsing errors
            }
          }
        } catch {
          // Skip invalid inscriptions
        }
      }
    } catch {
      // Skip transactions library can't process (bare multisigs)
    }
  }

  return { prevBlockhash, xfpPairs };

  function parseTransactionSize(bytes, offset) {
    const start = offset;

    offset += 4; // Skip version

    const isSegWit = bytes[offset] === 0x00 && bytes[offset + 1] === 0x01;
    if (isSegWit) {
      offset += 2; // Skip marker and flag
    }

    const { value: inputCount, size: inputCountSize } = readVarInt(bytes, offset);
    offset += inputCountSize;

    for (let i = 0; i < inputCount; i++) {
      offset += 36; // Skip previous output
      const { value: scriptSize, size: scriptSizeSize } = readVarInt(bytes, offset);
      offset += scriptSizeSize + scriptSize; // Skip scriptSig
      offset += 4; // Skip sequence
    }

    const { value: outputCount, size: outputCountSize } = readVarInt(bytes, offset);
    offset += outputCountSize;

    for (let i = 0; i < outputCount; i++) {
      offset += 8; // Skip value
      const { value: scriptSize, size: scriptSizeSize } = readVarInt(bytes, offset);
      offset += scriptSizeSize + scriptSize; // Skip scriptPubKey
    }

    if (isSegWit) {
      for (let i = 0; i < inputCount; i++) {
        const { value: witnessCount, size: witnessCountSize } = readVarInt(bytes, offset);
        offset += witnessCountSize;

        for (let j = 0; j < witnessCount; j++) {
          const { value: witnessSize, size: witnessSizeSize } = readVarInt(bytes, offset);
          offset += witnessSizeSize + witnessSize;
        }
      }
    }

    offset += 4; // Skip locktime
    return offset - start;
  }
}

processBlock(workerData)
  .then((result) => parentPort.postMessage(result))
  .catch((error) => {
    console.error('Error in worker:', error);
    process.exit(1);
  });

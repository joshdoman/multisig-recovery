import { parentPort, workerData } from 'worker_threads';
import ordinals from 'micro-ordinals';
import { Transaction } from '@scure/btc-signer';
import { hex, utf8 } from '@scure/base';

import parseEncryptedDescriptor from './parse.js';

async function processBlock(block) {
  const xfpPairs = {};

  for (const rawTx of block.tx) {
    try {
      const tx = Transaction.fromRaw(hex.decode(rawTx.hex), { 
        allowUnknownOutputs: true,
        disableScriptCheck: true,
      });
      for (const input of tx.inputs) {
        try {
          const inscriptions = ordinals.parseWitness(input.finalScriptWitness);
          for (const [i, inscription] of inscriptions.entries()) {
            if (!inscription.tags.contentType?.startsWith('text/plain')) continue;
            const inscriptionId = `${rawTx.txid}i${i}`;
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
      // Skip invalid transactions
    }
  }

  return xfpPairs;
}

processBlock(workerData)
  .then((result) => parentPort.postMessage(result))
  .catch((error) => {
    console.error('Error in worker:', error);
    process.exit(1);
  });

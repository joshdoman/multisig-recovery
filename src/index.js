import express from 'express';
import ordinals from 'micro-ordinals';
import { Transaction } from '@scure/btc-signer';
import { hex, utf8 } from '@scure/base';
import { JSONFilePreset } from 'lowdb/node';
import cors from 'cors';
import fs from 'fs';
import 'dotenv/config';

import parseEncryptedDescriptor from './parse.js';

const PORT = process.env.PORT || 3000;
const START_HEIGHT = process.env.START_HEIGHT || 870525;
const BITCOIN_NODE = process.env.BITCOIN_NODE || 'http://localhost:8332';
const DATA_PATH = process.env.DATA_DIR || './data';
const BASE_URL = `${BITCOIN_NODE}/rest`;

const app = express();
app.use(cors());

// Create data folder if it doesn't exist
if (!fs.existsSync(DATA_PATH)) {
  fs.mkdirSync(DATA_PATH);
}

// Initialize LowDB
const defaultData = { xfpPairs: {}, lastHeight: START_HEIGHT, lastBlockHash: '' };
const db = await JSONFilePreset(DATA_PATH + '/db.json', defaultData);

async function getBlockByBlockHash(blockHash) {
  try {
      // Get the block hash by height
      const response = await fetch(`${BASE_URL}/block/${blockHash}.json`);
      return await response.json();
  } catch (error) {
      console.error(`Error fetching block at block hash ${blockHash}:`, error);
      throw error;
  }
}

async function getBlockHashByHeight(height) {
    try {
        // Get the block hash by height
        const getBlockHash = await fetch(`${BASE_URL}/blockhashbyheight/${height}.json`);
        const blockHashJson = await getBlockHash.json();
        return blockHashJson.blockhash;
    } catch (error) {
        console.error(`Error fetching block hash at height ${height}:`, error);
        throw error;
    }
}

async function indexBlock(block) {
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
              // Cache xfp pairs in the database
              for (const xfpPairFingerprint of result.xfpPairFingerprints) {
                const inscriptionIds = db.data.xfpPairs[xfpPairFingerprint];
                if (inscriptionIds && !inscriptionIds.includes(inscriptionId)) {
                  db.data.xfpPairs[xfpPairFingerprint].push(inscriptionId);
                } else {
                  db.data.xfpPairs[xfpPairFingerprint] = [inscriptionId];
                }
                console.log(`Cached xfpPairFingerprint ${xfpPairFingerprint}, inscriptionID: ${inscriptionId}`);
              }
            } catch (error) {
              // No need to do anything. We can't parse an encrypted descriptor from the text
            }
          }
        } catch {
          // No need to do anything. We can't parse inscriptions from this witness
        }
      }
    } catch (error) {
      // Unable to parse transaction (typically due to bare multisig output)
      console.error(`Error parsing transaction ${rawTx.txid}: ${error}`);
    }
  }
}

async function fetchBlocks() {
  while (true) {
    try {
      // Get the latest block height
      const chainInfoResponse = await fetch(`${BASE_URL}/chaininfo.json`);
      const chainInfo = await chainInfoResponse.json();
      const latestHeight = chainInfo.blocks;

      // Fetch blocks up to the latest height
      while (db.data.lastHeight < latestHeight) {
        const nextHeight = db.data.lastHeight + 1;
        const blockHash = await getBlockHashByHeight(nextHeight);
        const block = await getBlockByBlockHash(blockHash);
        console.log(`Fetched block ${block.hash}`);
        await indexBlock(block);
        console.log(`Indexed block ${block.hash} at height:`, nextHeight);

        if (db.data.lastBlockHash && block.previousblockhash !== db.data.lastBlockHash) {
          db.data.lastHeight -= 6;
          db.data.lastBlockHash = '';
          console.log("Reorg detected, re-indexing last 6 blocks...");
        } else {
          db.data.lastHeight = nextHeight;
          db.data.lastBlockHash = block.hash;
        }
        await db.write();
      }

      // Wait before polling again
      console.log('Waiting for new blocks...');
      await new Promise(resolve => setTimeout(resolve, 60000)); // Poll every 60 seconds
    } catch (error) {
      console.error('Error during block fetching loop:', error);
    }
  }
}

// API to fetch cached inscriptionIds indexed at `xfpPairFingerprint`
app.get('/inscriptionIds/:xfpPairFingerprint', async (req, res) => {
  const { xfpPairFingerprint } = req.params;
  const inscriptionIds = db.data.xfpPairs[xfpPairFingerprint] ?? [];
  res.json({ xfpPairFingerprint, inscriptionIds });
});

// API to fetch cached height
app.get('/height', async (_, res) => {
  const height = db.data.lastHeight;
  res.json({ height });
});

// Start the server
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Start fetching blocks from the last cached height
  fetchBlocks().catch(error => console.error('Error:', error));
});
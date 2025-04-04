import express from 'express';
import { Worker } from 'worker_threads';
import { JSONFilePreset } from 'lowdb/node';
import cors from 'cors';
import fs from 'fs';
import 'dotenv/config';

const PORT = process.env.PORT || 3000;
const START_HEIGHT = process.env.START_HEIGHT || 870525;
const REINDEX_IF_REORG = process.env.REINDEX_IF_REORG || 6;
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
const defaultData = {
  inscriptionIds: [],
  xfpPairs: {},
  lastHeight: START_HEIGHT, 
  lastBlockHash: '',
};
const db = await JSONFilePreset(DATA_PATH + '/db.json', defaultData);

// Initialize inscription set for quick lookup to avoid duplicates
const inscriptionSet = new Set(db.data.inscriptionIds);

async function getBlockByBlockHash(blockHash) {
  try {
    // Get the block hash by height
    const response = await fetch(`${BASE_URL}/block/${blockHash}.hex`);
    return await response.text();
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

function processBlockInWorker(block) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./src/worker.js', { workerData: block });
    worker.on('message', (result) => {
      resolve(result);
      worker.terminate();
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}

async function indexBlock(block) {
  // Process block in worker so the main thread is not blocked
  const { previousBlockhash, inscriptionIds, xfpPairs } = await processBlockInWorker(block);
  // Update database with results from the worker
  inscriptionIds.forEach(inscriptionId => {
    if (!inscriptionSet.has(inscriptionId)) {
      inscriptionSet.add(inscriptionId);
      db.data.inscriptionIds.push(inscriptionId);
    }
  });
  for (const [xfpPairFingerprint, inscriptionIds] of Object.entries(xfpPairs)) {
    if (!db.data.xfpPairs[xfpPairFingerprint]) {
      db.data.xfpPairs[xfpPairFingerprint] = [];
    }
    db.data.xfpPairs[xfpPairFingerprint].push(...inscriptionIds.filter(id => 
      !db.data.xfpPairs[xfpPairFingerprint].includes(id)
    ));
    console.log(`Cached xfpPairFingerprint ${xfpPairFingerprint}, inscriptionIds: ${inscriptionIds.join(',')}`);
  }
  return previousBlockhash;
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
        const previousBlockhash = await indexBlock(block);
        console.log(`Indexed block ${blockHash} at height:`, nextHeight);

        if (db.data.lastBlockHash && previousBlockhash !== db.data.lastBlockHash) {
          db.data.lastHeight -= REINDEX_IF_REORG;
          db.data.lastBlockHash = '';
          console.log("Reorg detected, re-indexing last 6 blocks...");
        } else {
          db.data.lastHeight = nextHeight;
          db.data.lastBlockHash = blockHash;
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

// API to fetch list of cached inscriptionIds
app.get('/inscriptionIds', async (_, res) => {
  const inscriptionIds = db.data.inscriptionIds;
  res.json({ inscriptionIds });
});

// API to fetch cached inscriptionIds indexed at `xfpPairFingerprint`
app.get('/inscriptionIds/:xfpPairFingerprint', async (req, res) => {
  const { xfpPairFingerprint } = req.params;
  const inscriptionIds = db.data.xfpPairs[xfpPairFingerprint] ?? [];
  res.json({ xfpPairFingerprint, inscriptionIds });
});

// API to fetch number of cached inscriptionIds
app.get('/count', async (_, res) => {
  const count = db.data.inscriptionIds.length;
  res.json({ count });
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
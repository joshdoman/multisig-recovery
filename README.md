# multisig-recovery

A tiny ExpressJS server that indexes Bitcoin inscriptions made by [multisig-backup](https://github.com/joshdoman/multisig-backup) so 
they can be quickly found using any pair of master fingerprints.

## How it works
The server connects to a `BITCOIN_NODE` and downloads each block beginning with `START_HEIGHT`. Each block is scanned for inscriptions that 
represent an encrypted multisig descriptor, following the format in [multisig-backup](https://github.com/joshdoman/multisig-backup). 
This descriptor format includes the first four bytes of the SHA256 hash of each pair of master fingerprints (the `xfpPairFingerprint`). The
server extracts each `xfpPairFingerprint` and builds an index mapping `xfpPairFingerprints` to txids. Users can then easily find all txids
linked to a pair of master fingerprints.

## Pre-requisites
- Install [Node.js](https://nodejs.org/en/) version 8.0.0
- A Bitcoin full node with the `-rest` option enabled

## Environment variables
This project uses the following environment variables:

| Name                          | Description                         | Default Value                                  |
| ----------------------------- | ------------------------------------| -----------------------------------------------|
|PORT           | Specifies the port number on which the server listens for incoming HTTP requests               | 3000      |
|START_HEIGHT   | Specifies the block height at which indexing begins                                            | 870525      |
|BITCOIN_NODE   | Specifies the URL of the attached Bitcoin node                                                 | http://localhost:8332 |
|DATA_DIR       | Specifies the directory where the indexed data will be persisted                               | ./data |

## Getting started
- Clone the repository
```
git clone https://github.com/joshdoman/multisig-recovery
```
- Install dependencies
```
cd multisig-recovery
npm install
```
- Build and run the project
```
npm start
```
  Navigate to `http://localhost:3000`

- API endpoints

  Cached Block Height Endpoint : http://localhost:3000/height

  Cached Txids Endpoint : http://localhost:3000/txids/:xfpPairFingerprint

## Troubleshooting

If you encounter any issues, try the following:

1. Clear your browser cache and restart the development server.
2. Delete the `node_modules` folder and run `npm install` again.
3. Make sure your Node.js version is compatible with the project requirements.
4. Check for any error messages in the console and search for solutions online.

If problems persist, please open an issue on this project's GitHub repository.

## License

This project is open source and available under the [MIT License](LICENSE).

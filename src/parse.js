import { validateBIP32Path } from '@caravan/bitcoin';
import { hex, base64, base58 } from '@scure/base';

// Extracts each multisig in the descriptor, including xpubs, xfps, and the number
// of required signatures
const parseDescriptor = (descriptor) => {
  if (descriptor.includes("tr(")) {
    throw new Error('Taproot descriptors not supported yet');
  }

  const taprootPubKeyMatch = descriptor.match(/(?<=tr\()([xyztuvUVYZ]pub[a-zA-Z0-9]{107})(?=,)/g);
  const taprootPubKey = taprootPubKeyMatch ? base58.decode(taprootPubKeyMatch[0]) : undefined;

  const multiSigMatch = descriptor.match(/multi(?:_a)?\(([^)]*)\)/g);
  if (!multiSigMatch) {
    throw new Error('Invalid multsig descriptor. Must contain "[sorted]multi[_a](...)".');
  }

  const multisigs = [];
  for (const multisig of multiSigMatch) {
    const submatch = multisig.match(/multi(?:_a)?\((\d+),([^)]+)/);
    if (!submatch) {
      throw new Error('Invalid descriptor format.');
    }
    const requiredSigs = parseInt(submatch[1]);
    const fingerprintRegex = /\[([a-f0-9]{8})\//g;
    const xpubRegex = /([xyztuvUVYZ]pub[a-zA-Z0-9]{107})/g;
    const xfps = [...submatch[2].matchAll(fingerprintRegex)].map(match => hex.decode(match[1]));
    const xpubs = [
      ...submatch[2].matchAll(xpubRegex),
    ].map(m => m[1]).map(base58.decode);
    const numXpubs = submatch[2].split(',').length;
    const numXfps = submatch[2].split('[').length - 1;
    const derivationPaths = [
      ...submatch[2].matchAll(/\[([0-9/'h]*)\]/g),
    ].map(m => m[1]).filter(str => !validateBIP32Path(str.replace(/h/g, `'`)));
    multisigs.push({ requiredSigs, xfps, xpubs, derivationPaths, numXfps, numXpubs });
  }

  return { taprootPubKey, multisigs };
};

// Extracts stripped descriptor, required signatures, encrypted shares, encrypted data,
// numXfps, numXpubs, and xfp pair hashes from the encrypted text
export default function parseEncryptedDescriptor(encryptedText) {
  // Since the checksum is stripped from the descriptor, the encrypted descriptor
  // always ends with ")" followed by Base64 encoded text
  const parts = encryptedText.match(/(.*\))([A-Za-z0-9+/]*)/);
  if (!parts || parts.length !== 3) {
    throw new Error('Invalid encrypted text');
  }

  const strippedDescriptor = parts[1];
  const encodedData = base64.decode(parts[2]);
  const { multisigs: strippedMultisigs } = parseDescriptor(strippedDescriptor);
  let totalXpubs = 0;
  let totalXfps = 0;
  let i = 0;
  const groupedEncryptedShares = [];
  const bip32Paths = [];
  for (const { requiredSigs, numXfps, numXpubs, derivationPaths } of strippedMultisigs) {
    if (requiredSigs === 0 || numXpubs === 0) {
      throw new Error('Invalid encrypted text');
    }
    totalXpubs += numXpubs;
    totalXfps += numXfps;
    bip32Paths.push(...derivationPaths);

    const encryptedShareBytes = numXpubs > 1 && requiredSigs > 1 ? 33 : 32;
    if (i + encryptedShareBytes * numXpubs > encodedData.length) {
      throw new Error('Invalid encrypted text');
    }

    const allEncryptedShares = encodedData.slice(i, i + encryptedShareBytes * numXpubs);
    const encryptedShares = Array.from({ length: numXpubs }, (_, j) => 
      allEncryptedShares.slice(j * encryptedShareBytes, (j + 1) * encryptedShareBytes)
    );

    i = encryptedShareBytes * numXpubs;
    groupedEncryptedShares.push({
      encryptedShares,
      requiredSigs
    })
  }

  // Encrypted bytes: 4 bytes per xfp, 74 bytes per xpub
  const encryptedBytes = 4 * totalXfps + 74 * totalXpubs;
  if (i + encryptedBytes > encodedData.length) {
    throw new Error('Invalid encrypted text');
  }
  const encryptedData = encodedData.slice(i, i + encryptedBytes);
  i += encryptedBytes;

  // More than 20 keys not allowed
  if (totalXfps > 20) {
    throw new Error('Invalid encrypted text - too many xfps');
  }

  // 4 byte xfp pair fingerprints
  const xfpPairFingerprints = [];
  let maxNumXfpPairs = totalXfps * (totalXfps - 1) / 2;
  while (i + 4 <= encodedData.length && maxNumXfpPairs--) {
    xfpPairFingerprints.push(hex.encode(encodedData.slice(i, i + 4)));
    i += 4;
  }

  // Additional data not allowed
  if (encodedData.length > i) {
    throw new Error('Invalid encrypted text - excessively long');
  }

  return {
    strippedDescriptor,
    groupedEncryptedShares,
    encryptedData,
    xfpPairFingerprints,
    totalXfps,
    totalXpubs,
    bip32Paths
  };
}
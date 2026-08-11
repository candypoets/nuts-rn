import {bytesToHex, randomBytes} from '@noble/hashes/utils';
import {schnorr} from '@noble/curves/secp256k1.js';
import {HDKey} from '@scure/bip32';
import {generateMnemonic, mnemonicToSeedSync, validateMnemonic} from '@scure/bip39';
import {wordlist} from '@scure/bip39/wordlists/english.js';
import {nip19} from 'nostr-tools';

export function generateNostrKeypair() {
  const secret = randomBytes(32);
  const privkey = bytesToHex(secret);
  const pubkey = bytesToHex(schnorr.getPublicKey(secret));
  return {
    privkey,
    pubkey,
    nsec: nip19.nsecEncode(secret),
    npub: nip19.npubEncode(pubkey),
  };
}

export function generateSignupMnemonic() {
  return generateMnemonic(wordlist, 128);
}

export function deriveSignupKeypair(mnemonic: string, passphrase = '', index = 0) {
  const phrase = mnemonic.trim().replace(/\s+/g, ' ');
  if (!validateMnemonic(phrase, wordlist)) {
    throw new Error('Invalid signup mnemonic');
  }
  const seed = mnemonicToSeedSync(phrase, passphrase || undefined);
  const root = HDKey.fromMasterSeed(seed);
  const account = root.derive("m/44'/1237'/17375'");
  const chain = account.deriveChild(0);
  const child = chain.deriveChild(index);
  if (!child.privateKey) throw new Error('Unable to derive signup key');
  const privkey = bytesToHex(child.privateKey);
  const pubkey = bytesToHex(schnorr.getPublicKey(child.privateKey));
  return {
    privkey,
    pubkey,
    nsec: nip19.nsecEncode(child.privateKey),
    npub: nip19.npubEncode(pubkey),
  };
}

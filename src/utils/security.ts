import keytar from 'keytar';
import crypto from 'crypto';
import { app } from 'electron';
import { logger } from './logger';

const SERVICE_NAME = 'AntigravityManager';
const ACCOUNT_NAME = 'MasterKey';
const KEYCHAIN_ERROR_CODE = 'ERR_KEYCHAIN_UNAVAILABLE';
const KEYCHAIN_HINT_TRANSLOCATION = 'HINT_APP_TRANSLOCATION';
const KEYCHAIN_HINT_KEYCHAIN_DENIED = 'HINT_KEYCHAIN_DENIED';
const KEYCHAIN_HINT_SIGN_NOTARIZE = 'HINT_SIGN_NOTARIZE';

// Cache the key in memory to avoid frequent system calls
let cachedMasterKey: Buffer | null = null;

function buildKeychainAccessHint(error: unknown): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  let appPath = '';
  try {
    appPath = app.getAppPath();
  } catch {
    appPath = '';
  }

  const isTranslocated = appPath.includes('/AppTranslocation/');
  if (isTranslocated) {
    return KEYCHAIN_HINT_TRANSLOCATION;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.toLowerCase().includes('keychain')) {
    return KEYCHAIN_HINT_KEYCHAIN_DENIED;
  }

  return KEYCHAIN_HINT_SIGN_NOTARIZE;
}

async function getOrGenerateMasterKey(): Promise<Buffer> {
  if (cachedMasterKey) return cachedMasterKey;

  try {
    let hexKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);

    if (!hexKey) {
      logger.info('Security: Generating new master key...');
      // Generate 256-bit key (32 bytes)
      const buffer = crypto.randomBytes(32);
      hexKey = buffer.toString('hex');
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, hexKey);
    }

    cachedMasterKey = Buffer.from(hexKey, 'hex');
    return cachedMasterKey;
  } catch (error) {
    const hint = buildKeychainAccessHint(error);
    logger.error('Security: Failed to access keychain/credential manager', error);
    // Fallback? If we can't store the key, we can't persistently encrypt.
    // For now, throw to prevent data loss (better not to write than to write something we can't decrypt later or write plain text when promised encrypted)
    const message = hint ? `${KEYCHAIN_ERROR_CODE}|${hint}` : KEYCHAIN_ERROR_CODE;
    throw new Error(message);
  }
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Encrypts a string using AES-256-GCM.
 * Output format: "iv_hex:auth_tag_hex:ciphertext_hex"
 */
export async function encrypt(text: string): Promise<string> {
  try {
    const key = await getOrGenerateMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.error('Security: Encryption failed', error);
    throw error;
  }
}

/**
 * Decrypts a string using AES-256-GCM.
 * Input format: "iv_hex:auth_tag_hex:ciphertext_hex"
 */
export async function decrypt(text: string): Promise<string> {
  // Check if it's plain text (JSON) for backward compatibility
  // Very rough check: starts with { or [
  if (text.startsWith('{') || text.startsWith('[')) {
    return text;
  }

  // Also checking if it follows our pattern
  const parts = text.split(':');
  if (parts.length !== 3) {
    // Treat as plain text if it doesn't look like our encrypted format
    return text;
  }

  try {
    const key = await getOrGenerateMasterKey();

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // PhD Level: Audit Log (Masked)
    logger.debug(`Security: Decryption successful for payload length ${encryptedHex.length / 2}`);

    return decrypted;
  } catch (error) {
    logger.error('Security: Decryption failed - possible key mismatch or corrupted data', error);
    throw error;
  }
}

/**
 * Validates the integrity of the security system.
 */
export async function validateSecurityIntegrity(): Promise<boolean> {
  try {
    const testPayload = 'Antigravity_Integrity_Check_' + Date.now();
    const encrypted = await encrypt(testPayload);
    const decrypted = await decrypt(encrypted);
    const isValid = testPayload === decrypted;
    
    if (isValid) {
      logger.info('Security: Integrity check passed.');
    } else {
      logger.error('Security: Integrity check failed - data mismatch.');
    }
    
    return isValid;
  } catch (error) {
    logger.error('Security: Integrity check failed with error', error);
    return false;
  }
}

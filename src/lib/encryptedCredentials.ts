import type { ImageProviderId } from '@/types/gallery'

const providers = ['gemini', 'gpt', 'qwen', 'doubao', 'comfyui']
const iterations = 600000
const encoder = new TextEncoder()
export interface EncryptedCredential {
  version: 1
  provider: ImageProviderId
  salt: string
  iv: string
  cipher: string
}
function cryptoApi() {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持安全加密；不会改为明文保存')
  return globalThis.crypto
}
function check(provider: ImageProviderId, passphrase: string) {
  if (!providers.includes(provider)) throw new Error('供应商无效')
  if (passphrase.length < 12 || passphrase.length > 1024) throw new Error('解锁口令需要 12–1024 个字符，请使用独立的长口令')
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
function decode(text: string, min: number, max: number) {
  if (typeof text !== 'string' || text.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('加密记录无效')
  const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0))
  if (bytes.length < min || bytes.length > max || encode(bytes) !== text) throw new Error('加密记录无效')
  return bytes
}
async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const subtle = cryptoApi().subtle
  const material = await subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
// Binding the endpoint prevents restoring a key into a different provider destination.
function aad(provider: ImageProviderId, endpoint: string) {
  return encoder.encode(JSON.stringify(['pose-encrypted-credential',1,provider,endpoint.trim().replace(/\/+$/, '')]))
}
export async function encryptCredential(provider: ImageProviderId, endpoint: string, secret: string, passphrase: string): Promise<EncryptedCredential> {
  check(provider, passphrase)
  if (!secret.trim() || secret.length > 16384) throw new Error('请先输入有效的 API Key（最多 16384 字符）')
  const crypto = cryptoApi(), salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(secret)
  try {
    const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(provider,endpoint),tagLength:128},await derive(passphrase,salt),plaintext)
    return {version:1,provider,salt:encode(salt),iv:encode(iv),cipher:encode(new Uint8Array(cipher))}
  } finally { plaintext.fill(0) }
}
export async function decryptCredential(record: EncryptedCredential, provider: ImageProviderId, endpoint: string, passphrase: string): Promise<string> {
  check(provider,passphrase)
  if (record?.version !== 1 || record.provider !== provider) throw new Error('加密记录版本或供应商不匹配')
  try {
    const salt=decode(record.salt,16,16), iv=decode(record.iv,12,12), cipher=decode(record.cipher,17,65552)
    const plaintext = new Uint8Array(await cryptoApi().subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(provider,endpoint),tagLength:128},await derive(passphrase,salt),cipher))
    try {
      const secret = new TextDecoder('utf-8',{fatal:true}).decode(plaintext)
      if (!secret.trim() || secret.length>16384) throw new Error('invalid')
      return secret
    } finally { plaintext.fill(0) }
  } catch { throw new Error('无法解锁：请检查口令、供应商地址及加密记录是否完整；原记录未更改') }
}

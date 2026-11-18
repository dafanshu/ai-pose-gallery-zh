import type { ImageProviderId } from '@/types/gallery'
import { decryptCredential, encryptCredential, type EncryptedCredential } from './encryptedCredentials'
import { idbRead, idbWrite, idbDelete } from './idbStorage'
import { storageKey } from './runtime'

interface Storage {
  read(key: string): Promise<EncryptedCredential | undefined>
  write(key: string, value: EncryptedCredential): Promise<void>
  remove(key: string): Promise<void>
}
export function credentialStorage(storage: Storage = {read:idbRead,write:idbWrite,remove:idbDelete}) {
  const key = (provider: ImageProviderId) => {
    if (!['gemini','gpt','qwen','doubao','comfyui'].includes(provider)) throw new Error('供应商无效')
    return storageKey(`encrypted_api_key_v1:${provider}`)
  }
  const read = async (provider: ImageProviderId) => {
    try { return await storage.read(key(provider)) } catch { throw new Error('无法读取加密存储；不会覆盖原记录') }
  }
  return {
    async configured(provider: ImageProviderId) { return (await read(provider)) !== undefined },
    async save(provider: ImageProviderId, endpoint: string, secret: string, passphrase: string) {
      const record=await encryptCredential(provider,endpoint,secret,passphrase)
      try { await storage.write(key(provider),record) } catch { throw new Error('加密保存失败；请检查存储空间或权限，密钥未获得持久化保证') }
    },
    async unlock(provider: ImageProviderId, endpoint: string, passphrase: string) {
      const record=await read(provider)
      if (!record) throw new Error('此供应商没有已保存的密钥')
      return decryptCredential(record,provider,endpoint,passphrase)
    },
    async remove(provider: ImageProviderId) {
      try { await storage.remove(key(provider)) } catch { throw new Error('删除失败；加密记录可能仍存在') }
    },
  }
}

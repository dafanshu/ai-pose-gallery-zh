import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptCredential, decryptCredential } from '../src/lib/encryptedCredentials.ts'
import { credentialStorage } from '../src/lib/credentialStorage.ts'
const password='synthetic-long-passphrase-only', endpoint='https://api.example.test/v1', secret='synthetic-provider-key-only'
function memory() {
  const rows=new Map()
  return {rows,async read(key){return structuredClone(rows.get(key))},async write(key,value){rows.set(key,structuredClone(value))},async remove(key){rows.delete(key)}}
}
test('encrypted records survive new service instances without persisting plaintext or passphrase', async()=>{
  const store=memory();await credentialStorage(store).save('gpt',endpoint,secret,password)
  assert.equal(await credentialStorage(store).configured('gpt'),true)
  assert.doesNotMatch(JSON.stringify([...store.rows]),/synthetic-provider-key|synthetic-long-passphrase/)
  assert.equal(await credentialStorage(store).unlock('gpt',endpoint,password),secret)
  await credentialStorage(store).remove('gpt')
  assert.equal(await credentialStorage(store).configured('gpt'),false)
  await assert.rejects(credentialStorage(store).unlock('gpt',endpoint,password),/没有已保存/)
})
test('provider and destination binding reject cross-provider, changed endpoint and tampered ciphertext',async()=>{
  const record=await encryptCredential('gpt',endpoint,secret,password)
  await assert.rejects(decryptCredential(record,'gemini',endpoint,password),/供应商不匹配/)
  await assert.rejects(decryptCredential({...record,provider:'gemini'},'gemini',endpoint,password),/无法解锁/)
  await assert.rejects(decryptCredential(record,'gpt','https://other.example/v1',password),/无法解锁/)
  await assert.rejects(decryptCredential({...record,cipher:(record.cipher[0]==='A'?'B':'A')+record.cipher.slice(1)},'gpt',endpoint,password),/无法解锁/)
})
test('wrong password and corrupted format leave stored record unchanged',async()=>{
  const store=memory(), service=credentialStorage(store)
  await service.save('gpt',endpoint,secret,password)
  const before=JSON.stringify([...store.rows])
  await assert.rejects(service.unlock('gpt',endpoint,'wrong-synthetic-password'),/无法解锁/)
  assert.equal(JSON.stringify([...store.rows]),before)
  const record=[...store.rows.values()][0]
  await assert.rejects(decryptCredential({...record,version:2},'gpt',endpoint,password),/版本/)
  await assert.rejects(decryptCredential({...record,iv:'invalid'},'gpt',endpoint,password),/无法解锁/)
})
test('separate provider save and delete do not affect another provider',async()=>{
  const store=memory(), service=credentialStorage(store)
  await service.save('gpt',endpoint,secret,password)
  await service.save('gemini',endpoint,'synthetic-gemini-key',password)
  await service.remove('gpt')
  assert.equal(await service.unlock('gemini',endpoint,password),'synthetic-gemini-key')
})
test('random salt and IV make repeated saves different; weak passwords are rejected',async()=>{
  const one=await encryptCredential('gpt',endpoint,secret,password),two=await encryptCredential('gpt',endpoint,secret,password)
  assert.notEqual(one.salt,two.salt);assert.notEqual(one.iv,two.iv);assert.notEqual(one.cipher,two.cipher)
  await assert.rejects(encryptCredential('gpt',endpoint,secret,'short'),/12/)
  await assert.rejects(encryptCredential('gpt',endpoint,'',password),/有效/)
})
test('storage failures are reported and no plaintext fallback writes occur',async()=>{
  let writes=0
  const service=credentialStorage({async read(){throw Error('read')},async write(_key,value){writes++;assert.ok(value.cipher);assert.equal(value.apiKey,undefined);throw Error('quota')},async remove(){throw Error('delete')}})
  await assert.rejects(service.configured('gpt'),/读取/)
  await assert.rejects(service.save('gpt',endpoint,secret,password),/保存失败/)
  await assert.rejects(service.remove('gpt'),/删除失败/)
  assert.equal(writes,1)
})
test('missing WebCrypto fails closed before writing anything',async t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'crypto')
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}})
  t.after(()=>Object.defineProperty(globalThis,'crypto',original))
  const store=memory()
  await assert.rejects(credentialStorage(store).save('gpt',endpoint,secret,password),/不支持安全加密/)
  assert.equal(store.rows.size,0)
})

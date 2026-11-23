const assert = require('assert');
const { createUpdatePrompts } = require('../lib/updatePrompts');

async function main() {
  const prompts = createUpdatePrompts();
  let dismiss;
  let offers = 0;
  const first = prompts.run('available', () => {
    offers += 1;
    return new Promise(resolve => { dismiss = resolve; });
  });
  assert.strictEqual(prompts.busy, true);
  await prompts.run('available', () => { offers += 1; });
  assert.strictEqual(offers, 1, 'A second updater event must not open another offer.');
  let ready = false;
  await prompts.run('ready', () => { ready = true; });
  assert.strictEqual(ready, true, 'Download completion can show its prompt before downloadUpdate resolves.');
  assert.strictEqual(prompts.busy, true, 'Finishing the ready prompt must not unlock the pending offer.');
  dismiss();
  await first;
  assert.strictEqual(prompts.busy, false);
  await assert.rejects(prompts.run('available', () => { throw new Error('dialog failed'); }), /dialog failed/);
  assert.strictEqual(prompts.busy, false, 'A failed dialog must allow a later retry.');
  await prompts.run('available', () => { offers += 1; });
  assert.strictEqual(offers, 2);
  console.log('Update prompt concurrency checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

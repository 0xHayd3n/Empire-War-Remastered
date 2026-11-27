// Public API, real disposable workerd + SQLite. No Steam or production service.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  os = require('node:os'),
  { randomBytes } = require('node:crypto');
const { worker } = require('./test-relay-fixture.cjs');
if (require.main === module)
  (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaw-social-'));
    const port = 9070;
    let relay;
    try {
      relay = worker(tmp, port);
      await relay.ready;
      const endpoint = `http://127.0.0.1:${port}/social/v1`,
        a = randomBytes(32).toString('hex'),
        b = randomBytes(32).toString('hex'),
        c = randomBytes(32).toString('hex');
      const send = async (key, op, args = {}, status = 200) => {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
          body: JSON.stringify({ op, ...args })
        });
        const body = await r.json();
        assert.equal(r.status, status, body.error);
        return body;
      };
      const [A, B, C] = await Promise.all(
        [a, b, c].map((k, i) => send(k, 'enable', { name: ['Aurek', 'Besh', 'Cresh'][i] }).then(s => s.me.id))
      );
      assert.notEqual(A, B);
      const m = { target: B, room: 'ccdd234ab', kind: 'lan', profile: 'stock', stamp: '1'.repeat(64) };
      await send(a, 'invite', m, 403);
      await send(c, 'history', { target: B }, 403);
      await send(a, 'request', { target: B });
      await send(a, 'approve', { target: B }, 400);
      await send(b, 'approve', { target: A });
      await send(a, 'chat', { target: B, body: 'form up' });
      assert.deepEqual(
        (await send(b, 'history', { target: A })).messages.map(m => m.body),
        ['form up']
      );
      await send(a, 'invite', m);
      assert.equal((await send(b, 'state')).invites[0].room, m.room);
      assert.equal((await send(c, 'state')).invites.length, 0);
      await send(c, 'join', { target: A }, 403);
      assert.equal((await send(b, 'join', { target: A })).invite.room, m.room);
      await send(b, 'join', { target: A }, 410);
      await send(a, 'invite', m);
      await send(a, 'withdraw', { target: B });
      assert.equal((await send(b, 'state')).invites.length, 0);
      await send(a, 'invite', m);
      await send(b, 'block', { target: A });
      assert.equal((await send(b, 'state')).invites.length, 0);
      await send(a, 'chat', { target: B, body: 'x' }, 403);
      await send(a, 'request', { target: B }, 400);
      await send(b, 'unblock', { target: A });
      await send(a, 'request', { target: B });
      assert.equal((await send(b, 'state')).friends[0].confirmed, 0);
      await send(b, 'remove', { target: A });
      assert.equal((await send(a, 'state')).friends.length, 0);
      console.log('Durable roster: consent, mutual chat, private invites, explicit join/withdraw, block cleanup and decline passed.');
    } finally {
      await relay?.dispose();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })().catch(e => {
    console.error(e);
    process.exitCode = 1;
  });

// Per-relay social roster. Public commander codes are NOT credentials. A random 256-bit
// browser key is presented over HTTPS (or a loopback relay); only its digest is stored.
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const clean = (s, n) =>
  typeof s === 'string'
    ? s
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .trim()
        .slice(0, n)
    : '';
const digest = async s =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), v => v.toString(16).padStart(2, '0')).join(
    ''
  );
const codeRe = /^[a-f0-9]{16}$/,
  roomRe = /^[a-z2-9]{9}$/,
  ttl = 600000,
  week = 604800000;
class Denied extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function demand(ok, msg, status) {
  if (!ok) throw new Denied(msg, status);
}
export class Social {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql
      .exec(`CREATE TABLE IF NOT EXISTS pilots(id TEXT PRIMARY KEY, proof TEXT NOT NULL, name TEXT NOT NULL, seen INTEGER DEFAULT 0, visible INTEGER DEFAULT 1, burst INTEGER DEFAULT 0, window INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS links(a TEXT,b TEXT,asked TEXT,confirmed INTEGER,PRIMARY KEY(a,b));CREATE INDEX IF NOT EXISTS links_b ON links(b);
 CREATE TABLE IF NOT EXISTS blocks(src TEXT,dst TEXT,PRIMARY KEY(src,dst));CREATE INDEX IF NOT EXISTS blocks_dst ON blocks(dst);
 CREATE TABLE IF NOT EXISTS invites(src TEXT,dst TEXT,room TEXT,kind TEXT,profile TEXT,stamp TEXT,until INTEGER,PRIMARY KEY(src,dst));CREATE INDEX IF NOT EXISTS invites_dst ON invites(dst);
 CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,a TEXT,b TEXT,src TEXT,body TEXT,at INTEGER);CREATE INDEX IF NOT EXISTS msg_pair ON messages(a,b,id);CREATE INDEX IF NOT EXISTS msg_time ON messages(at);
 CREATE TABLE IF NOT EXISTS enroll(bucket TEXT PRIMARY KEY,n INTEGER,until INTEGER);`);
  }
  rows(q, ...args) {
    return this.sql.exec(q, ...args).toArray();
  }
  one(q, ...args) {
    return this.rows(q, ...args)[0];
  }
  async fetch(req) {
    try {
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '')?.[1];
      demand(token, 'Commander sign-in required.', 401);
      const reader = req.body?.getReader();
      demand(reader, 'Expected a request.');
      const decoder = new TextDecoder();
      let raw = '',
        n = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        n += part.value.byteLength;
        if (n > 2048) {
          await reader.cancel();
          throw new Denied('Request too large.', 413);
        }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        throw new Denied('Invalid request.');
      }
      demand(m && typeof m === 'object' && !Array.isArray(m), 'Invalid request.');
      const proof = await digest('eaw-commander-v1:' + token),
        id = proof.slice(0, 16),
        bucket = m.op === 'enable' ? await digest('enroll:' + (req.headers.get('cf-connecting-ip') || 'local')) : '',
        now = Date.now();
      const result = this.storage.transactionSync(() => this.dispatch(id, proof, m, now, bucket));
      return json(result);
    } catch (e) {
      return json({ error: e instanceof Denied ? e.message : 'Social roster unavailable.' }, e instanceof Denied ? e.status : 503);
    }
  }
  dispatch(id, proof, m, now, bucket) {
    const run = (q, ...args) => this.sql.exec(q, ...args),
      who = this.one('SELECT * FROM pilots WHERE id=?', id);
    if (!who) {
      demand(m.op === 'enable', 'Enable social for this device first.', 401);
      run('DELETE FROM enroll WHERE until<=?', now);
      const recent = this.one('SELECT n FROM enroll WHERE bucket=?', bucket);
      demand((recent?.n || 0) < 25 && this.one('SELECT count(*) AS n FROM pilots').n < 50000, 'Registration is temporarily full.', 429);
      const name = clean(m.name, 32);
      demand(name, 'Enter a callsign.');
      run('INSERT INTO pilots(id,proof,name,seen) VALUES(?,?,?,?)', id, proof, name, now);
      run('INSERT INTO enroll VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=n+1', bucket, now + 3600000);
    } else {
      demand(who.proof === proof, 'Commander sign-in failed.', 403);
      const hits = who.window + 10000 > now ? who.burst : 0;
      demand(hits < 35, 'Please wait before sending more transmissions.', 429);
      run('UPDATE pilots SET seen=?,burst=?,window=? WHERE id=?', now, hits + 1, hits ? who.window : now, id);
    }
    run('DELETE FROM invites WHERE until<=?', now);
    run('DELETE FROM messages WHERE at<?', now - week);
    if (m.op === 'enable' || m.op === 'state') return this.state(id, now);
    if (m.op === 'rename') {
      const name = clean(m.name, 32);
      demand(name, 'Enter a callsign.');
      run('UPDATE pilots SET name=? WHERE id=?', name, id);
      return this.state(id, now);
    }
    if (m.op === 'presence') {
      run('UPDATE pilots SET visible=? WHERE id=?', m.visible === true ? 1 : 0, id);
      return this.state(id, now);
    }
    const target = m.target;
    demand(typeof target === 'string' && codeRe.test(target) && target !== id, 'Enter another commander’s 16-character code.');
    const [a, b] = [id, target].sort(),
      tuple = [a, b];
    const relation = this.one('SELECT asked,confirmed FROM links WHERE a=? AND b=?', ...tuple);
    const blocked = !!this.one('SELECT 1 FROM blocks WHERE (src=? AND dst=?) OR (src=? AND dst=?)', id, target, target, id);
    const clear = () => {
      run('DELETE FROM links WHERE a=? AND b=?', ...tuple);
      run('DELETE FROM messages WHERE a=? AND b=?', ...tuple);
      run('DELETE FROM invites WHERE (src=? AND dst=?) OR (src=? AND dst=?)', id, target, target, id);
    };
    const connected = () => demand(!blocked && relation?.confirmed, 'Only accepted friends can do that.', 403);
    if (m.op === 'block') {
      demand(this.one('SELECT 1 FROM pilots WHERE id=?', target), 'Unavailable commander.');
      demand(this.one('SELECT count(*) AS n FROM blocks WHERE src=?', id).n < 128, 'Block list is full.');
      run('INSERT OR IGNORE INTO blocks VALUES(?,?)', id, target);
      clear();
    } else if (m.op === 'unblock') run('DELETE FROM blocks WHERE src=? AND dst=?', id, target);
    else if (m.op === 'request') {
      demand(!blocked && this.one('SELECT id FROM pilots WHERE id=?', target), 'Commander unavailable. Check the code and relay.');
      demand(!relation, 'There is already a request or friendship.');
      for (const p of [id, target])
        demand(this.one('SELECT count(*) AS n FROM links WHERE a=? OR b=?', p, p).n < 96, 'This roster is full.');
      run('INSERT INTO links VALUES(?,?,?,0)', a, b, id);
    } else if (m.op === 'approve') {
      demand(!blocked && relation?.asked === target && !relation.confirmed, 'Request no longer available.');
      run('UPDATE links SET confirmed=1 WHERE a=? AND b=?', ...tuple);
    } else if (m.op === 'remove') {
      demand(relation, 'Connection no longer available.');
      clear();
    } else if (m.op === 'invite') {
      connected();
      demand(
        roomRe.test(m.room) &&
          ['lan', 'internet'].includes(m.kind) &&
          typeof m.profile === 'string' &&
          /^(stock|local|\d{1,20})$/.test(m.profile) &&
          typeof m.stamp === 'string' &&
          /^[a-f0-9]{64}$/.test(m.stamp),
        'Invalid lobby invitation.'
      );
      run('INSERT OR REPLACE INTO invites VALUES(?,?,?,?,?,?,?)', id, target, m.room, m.kind, m.profile, m.stamp, now + ttl);
    } else if (m.op === 'join' || m.op === 'dismiss') {
      connected();
      const invite = this.one('SELECT room,kind,profile,stamp,until FROM invites WHERE src=? AND dst=? AND until>?', target, id, now);
      demand(invite, 'Invitation expired or withdrawn.', 410);
      run('DELETE FROM invites WHERE src=? AND dst=?', target, id);
      if (m.op === 'join') return { invite, state: this.state(id, now) };
    } else if (m.op === 'withdraw') {
      connected();
      run('DELETE FROM invites WHERE src=? AND dst=?', id, target);
    } else if (m.op === 'chat' || m.op === 'history') {
      connected();
      if (m.op === 'chat') {
        const body = clean(m.body, 240);
        demand(body, 'Write a message first.');
        run('INSERT INTO messages(a,b,src,body,at) VALUES(?,?,?,?,?)', a, b, id, body, now);
        run(
          'DELETE FROM messages WHERE a=? AND b=? AND id NOT IN(SELECT id FROM messages WHERE a=? AND b=? ORDER BY id DESC LIMIT 32)',
          a,
          b,
          a,
          b
        );
      }
      return { messages: this.rows('SELECT src,body,at FROM messages WHERE a=? AND b=? ORDER BY id', ...tuple) };
    } else throw new Denied('Unknown roster operation.');
    return this.state(id, now);
  }
  state(id, now) {
    const friends = this.rows(
      `SELECT p.id,p.name,l.asked,l.confirmed, (l.confirmed=1 AND p.visible=1 AND p.seen>?) AS online FROM links l JOIN pilots p ON p.id=CASE WHEN l.a=? THEN l.b ELSE l.a END WHERE l.a=? OR l.b=? ORDER BY p.name COLLATE NOCASE`,
      now - 90000,
      id,
      id,
      id
    );
    return {
      me: this.one('SELECT id,name,visible FROM pilots WHERE id=?', id),
      friends,
      blocked: this.rows('SELECT dst AS id,p.name FROM blocks JOIN pilots p ON dst=p.id WHERE src=?', id),
      invites: this.rows(
        'SELECT src AS id,p.name,i.kind,i.profile,i.room,i.stamp,i.until FROM invites i JOIN pilots p ON p.id=src WHERE dst=? ORDER BY i.until DESC',
        id
      ),
      sent: this.rows('SELECT dst AS id,room,until FROM invites WHERE src=?', id)
    };
  }
}

// Only mount in manual staging. The social feature owns recipients, delivery and acceptance.
export function stagingInvite(parent, net, kind, joinable, notify) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'staging-invite';
  b.textContent = 'Invite friends';
  const offered = () => ['lan', 'internet'].includes(kind) && !net.closing && net.ws?.readyState === 1 && joinable();
  let dismiss;
  const update = () => {
    b.hidden = !offered();
    if (b.hidden) {
      dismiss?.();
      dismiss = null;
    }
  };
  b.onclick = async () => {
    try {
      const { openInvitePanel } = await import('./socialpanel.js');
      if (b.isConnected && offered()) dismiss = openInvitePanel({ room: net.gameId, kind: kind === 'lan' ? 'lan' : 'internet' });
    } catch {
      if (b.isConnected) notify('Invitations are unavailable. You can still share the join code.');
    }
  };
  parent.append(b);
  update();
  const offs = ['away', 'back', 'closed'].map(event => net.on(event, update));
  return {
    update,
    close: () => {
      dismiss?.();
      offs.forEach(off => off());
      b.remove();
    }
  };
}

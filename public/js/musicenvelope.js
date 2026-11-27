// Keep the unattenuated level of every current or fading music element. A dialogue
// pause, mute or cancellation then restores its *current fade*, not full volume.
export class MusicEnvelope {
  levels = new Map();
  gain = 1;

  write(track, level) {
    this.levels.set(track, level);
    track.volume = level * this.gain;
  }

  duck(gain) {
    if (this.gain === gain) return;
    this.gain = gain;
    for (const [track, level] of this.levels) track.volume = level * gain;
  }

  release(track) {
    this.levels.delete(track);
    track.onended = track.onerror = null;
    track.pause();
    track.src = '';
    track.node?.disconnect();
  }
}

import { fetchPactlData, resolveMediaChannels } from './media/fetchMediaChannels';
import { fetchMediaPlayerStatus } from './mediaplayer/fetchMediaPlayerStatus';
import { updateMediaPlayer } from './mediaplayer/updateMediaPlayer';
import { listenToMidi } from './midi/listenToMidi';
import { updateMidiChannels } from './midi/updateMidiChannels';
import { mediaChannels, setMediaChannels } from './state/mediaChannels';
import { startServer } from './server';

(() => {
  startServer();
  try {
    listenToMidi();
  } catch (e) {
    console.error('Could not connect to MIDI device at startup:', e);
  }

  setInterval(async () => {
    const pactl = await fetchPactlData();
    const chA = resolveMediaChannels(pactl, 'a');
    const chB = resolveMediaChannels(pactl, 'b');
    setMediaChannels(chA, 'a');
    setMediaChannels(chB, 'b');

    updateMidiChannels(mediaChannels, 'a');
    updateMidiChannels(mediaChannels, 'b');

    updateMediaPlayer(await fetchMediaPlayerStatus(), () => mediaChannels('a'));
  }, 1000);
})();

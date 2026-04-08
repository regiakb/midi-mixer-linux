import { fetchPactlData, resolveMediaChannels } from './media/fetchMediaChannels';
import { fetchMediaPlayerStatus } from './mediaplayer/fetchMediaPlayerStatus';
import { updateMediaPlayer } from './mediaplayer/updateMediaPlayer';
import { listenToMidi } from './midi/listenToMidi';
import { updateMidiChannels } from './midi/updateMidiChannels';
import { isMidiConnected } from './midi/midiConnection';
import { mediaChannels, setMediaChannels } from './state/mediaChannels';
import { getActiveLayer } from './state/activeLayer';
import { startServer } from './server';

let midiListening = false;

const tryInitMidi = () => {
  if (midiListening) return;
  try {
    listenToMidi();
    midiListening = true;
    console.error('MIDI device connected and listening.');
  } catch {
    // Device not ready yet — will retry on next tick
  }
};

(() => {
  startServer();
  tryInitMidi();

  setInterval(async () => {
    const pactl = await fetchPactlData();
    const chA = resolveMediaChannels(pactl, 'a');
    const chB = resolveMediaChannels(pactl, 'b');
    setMediaChannels(chA, 'a');
    setMediaChannels(chB, 'b');

    // Retry MIDI init if device wasn't available at startup
    if (!midiListening) tryInitMidi();

    // Only update active layer LEDs — skip if not connected to avoid crash
    if (isMidiConnected()) {
      try {
        updateMidiChannels(mediaChannels, getActiveLayer());
      } catch {
        midiListening = false; // device disconnected mid-session, allow re-init
      }
    }

    updateMediaPlayer(await fetchMediaPlayerStatus(), () => mediaChannels('a'));
  }, 1000);
})();

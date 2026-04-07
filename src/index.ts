import { fetchMediaChannels } from './media/fetchMediaChannels';
import { fetchMediaPlayerStatus } from './mediaplayer/fetchMediaPlayerStatus';
import { updateMediaPlayer } from './mediaplayer/updateMediaPlayer';
import { listenToMidi } from './midi/listenToMidi';
import { updateMidiChannels } from './midi/updateMidiChannels';
import { mediaChannels, setMediaChannels } from './state/mediaChannels';
import { startServer } from './server';

(() => {
  startServer();
  listenToMidi();

  setInterval(async () => {
    const [chA, chB] = await Promise.all([
      fetchMediaChannels('a'),
      fetchMediaChannels('b'),
    ]);
    setMediaChannels(chA, 'a');
    setMediaChannels(chB, 'b');

    updateMidiChannels(mediaChannels, 'a');
    updateMidiChannels(mediaChannels, 'b');

    updateMediaPlayer(await fetchMediaPlayerStatus(), () => mediaChannels('a'));
  }, 1000);
})();

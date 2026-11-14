import { exec } from '../helpers/exec';

const TARGET_SINK = 'spotify_sink';

// Spotify's Electron audio process sometimes self-reports application.name as
// "Chromium" instead of "Spotify" on relaunch, which breaks WirePlumber's
// name-keyed stream-target restore and leaves the stream on the hardware sink
// instead of our virtual one. application.process.binary stays "spotify"
// regardless, so route on that instead of relying on the restore.
export const routeSpotifyToVirtualSink = async () => {
  try {
    const [{ stdout: sinkInputs }, { stdout: sinks }] = await Promise.all([
      exec('pactl list sink-inputs'),
      exec('pactl list sinks short'),
    ]);

    if (!sinks.split('\n').some(line => line.includes(TARGET_SINK))) return;

    const blocks = sinkInputs.split(/^(?=Sink Input #)/m).filter(b => b.trim());
    for (const block of blocks) {
      const idxMatch = block.match(/^Sink Input #(\d+)/);
      const binaryMatch = block.match(/application\.process\.binary = "([^"]+)"/m);
      const appNameMatch = block.match(/application\.name = "([^"]+)"/m);
      const nodeNameMatch = block.match(/node\.name = "([^"]+)"/m);
      // The Flatpak build streams via PipeWire natively and exposes no
      // application.process.binary, so also accept node.name/application.name.
      const isSpotify = binaryMatch?.[1] === 'spotify'
        || nodeNameMatch?.[1] === 'spotify'
        || appNameMatch?.[1]?.toLowerCase() === 'spotify';
      if (!idxMatch || !isSpotify || nodeNameMatch?.[1] === `${TARGET_SINK}_playback`) continue;

      const sinkLine = block.match(/^\s+Sink:\s+(\d+)/m);
      const targetId = sinks.split('\n').find(line => line.includes(TARGET_SINK))?.split('\t')[0];
      if (sinkLine && targetId && sinkLine[1] === targetId) continue;

      await exec(`pactl move-sink-input ${idxMatch[1]} ${TARGET_SINK}`);
    }
  } catch (error) {
    console.error(error);
  }
};

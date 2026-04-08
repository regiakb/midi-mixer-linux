import { spawn } from 'child_process';
import { exec } from '../helpers/exec';
import { volumeEncoderValueToPercentage } from '../helpers/volume';
import { setMuteState } from '../media/setMuteState';
import { setVolume } from '../media/setVolume';
import { nextMedia, playOrPauseMedia, previousMedia, stopMedia } from '../mediaplayer/control';
import { Layer, readConfig } from '../config';
import { mediaChannels, updateChannelMute } from '../state/mediaChannels';
import { getActiveLayer, setActiveLayer } from '../state/activeLayer';
import { scheduleLayerModeResend, updateMidiChannels } from './updateMidiChannels';
import { midiInput, midiOutput } from './midiConnection';

// Layer A: CC 1-8 (enc), CC 9 (fader), notes 0-7 (enc push), 8-15 (row1), 16-23 (row2)
// Layer B: CC 11-18 (enc), CC 10 (fader), notes 32-39 (enc push), 40-47 (row1), 48-55 (row2)

const launchApp = (action: string): void => {
  const child = spawn(
    'systemd-run',
    ['--user', '--scope', '/bin/sh', '-c', action],
    { stdio: 'ignore', detached: true },
  );
  child.unref();
};

// Detect layer switch from incoming MIDI events and force immediate LED resync
const onLayerActivity = (layer: Layer): void => {
  if (getActiveLayer() === layer) return;
  setActiveLayer(layer);
  scheduleLayerModeResend(layer);
  // Resend immediately — don't wait for the next 1-second interval tick
  updateMidiChannels(mediaChannels, layer);
};

const doMute = async (channelIndex: number, layer: Layer, row1NoteBase: number) => {
  const ch = mediaChannels(layer)[channelIndex];
  if (!ch) return;
  const newMuted = !ch.muted;
  updateChannelMute(channelIndex, newMuted, layer);
  midiOutput().send('noteon', { note: channelIndex + row1NoteBase, velocity: newMuted ? 127 : 0, channel: 10 });
  await setMuteState(ch, newMuted);
};

const handleButton = async (channelIndex: number, layer: Layer, action: string | null, row1NoteBase: number) => {
  if (!action) return;
  if (action === 'mute') {
    await doMute(channelIndex, layer, row1NoteBase);
  } else {
    launchApp(action);
  }
};

export const listenToMidi = (): void => {
  midiInput().on('noteon', async msg => {
    if (msg.velocity === 0) return;
    const { layerA, layerB } = readConfig();

    // Layer A — encoder push (notes 0-7)
    if (msg.note >= 0 && msg.note <= 7) {
      onLayerActivity('a');
      await handleButton(msg.note, 'a', layerA.buttonActions[msg.note], 8);
    }
    // Layer A — row 1 (notes 8-15)
    else if (msg.note >= 8 && msg.note <= 15) {
      onLayerActivity('a');
      await handleButton(msg.note - 8, 'a', layerA.bottomRow1Actions[msg.note - 8], 8);
    }
    // Layer A — row 2 (notes 16-23)
    else if (msg.note >= 16 && msg.note <= 23) {
      onLayerActivity('a');
      await handleButton(msg.note - 16, 'a', layerA.bottomRow2Actions[msg.note - 16], 8);
    }
    // Layer B — encoder push (notes 32-39)
    else if (msg.note >= 32 && msg.note <= 39) {
      onLayerActivity('b');
      await handleButton(msg.note - 32, 'b', layerB.buttonActions[msg.note - 32], 40);
    }
    // Layer B — row 1 (notes 40-47)
    else if (msg.note >= 40 && msg.note <= 47) {
      onLayerActivity('b');
      await handleButton(msg.note - 40, 'b', layerB.bottomRow1Actions[msg.note - 40], 40);
    }
    // Layer B — row 2 (notes 48-55)
    else if (msg.note >= 48 && msg.note <= 55) {
      onLayerActivity('b');
      await handleButton(msg.note - 48, 'b', layerB.bottomRow2Actions[msg.note - 48], 40);
    }
    // Media transport (Layer A: notes 18-22)
    else if (msg.note === 21) await stopMedia();
    else if (msg.note === 22) await playOrPauseMedia();
    else if (msg.note === 19) await nextMedia();
    else if (msg.note === 18) await previousMedia();
  });

  midiInput().on('cc', async msg => {
    const val = volumeEncoderValueToPercentage(msg.value);

    // Layer A fader (CC 9)
    if (msg.controller === 9) {
      onLayerActivity('a');
      await exec(`pactl set-sink-volume @DEFAULT_SINK@ ${val}%`);
    }
    // Layer B fader (CC 10)
    else if (msg.controller === 10) {
      onLayerActivity('b');
      await exec(`pactl set-sink-volume @DEFAULT_SINK@ ${val}%`);
    }
    // Layer A knobs (CC 1-8)
    else if (msg.controller >= 1 && msg.controller <= 8) {
      onLayerActivity('a');
      const ch = mediaChannels('a')[msg.controller - 1];
      if (ch) await setVolume(ch, val);
    }
    // Layer B knobs (CC 11-18)
    else if (msg.controller >= 11 && msg.controller <= 18) {
      onLayerActivity('b');
      const ch = mediaChannels('b')[msg.controller - 11];
      if (ch) await setVolume(ch, val);
    }
  });
};

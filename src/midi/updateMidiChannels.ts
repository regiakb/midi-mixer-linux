import { volumePercentageToEncoder } from '../helpers/volume';
import { mediaChannelsType } from '../types';
import { Layer } from '../config';
import { midiNrOfChannels, midiOutput } from './midiConnection';

// X-Touch Mini Standard mode
// Layer A: CC 1-8 (ring), notes 8-15 (row1 LED), notes 16-23 (row2 LED)
// Layer B: CC 11-18 (ring), notes 40-47 (row1 LED), notes 48-55 (row2 LED)
const RING_MODE_CHANNEL = 0;
const RING_VALUE_CHANNEL = 10;
const BUTTON_CHANNEL = 10;
const RING_MODE_FAN = 2;
const RING_MODE_OFF = 0;

const LAYER_OFFSETS = {
  a: { cc: 0,  row1Note: 8,  row2Note: 16 },
  b: { cc: 10, row1Note: 40, row2Note: 48 },
};

// Only deduplicate mute LED button state
// mode+value are always sent every tick so the device stays in sync
// even after a silent layer switch (no MIDI event is emitted by the device)
type ChannelState = { muted: boolean };
const prevState: Record<string, ChannelState> = {};

// no-op kept for import compatibility with listenToMidi.ts
export const scheduleLayerModeResend = (_layer: Layer): void => {};

export const updateMidiChannels = (mediaChannels: (layer: Layer) => mediaChannelsType, layer: Layer) => {
  const offsets = LAYER_OFFSETS[layer];

  for (let i = 0; i < midiNrOfChannels(); i++) {
    const ch = mediaChannels(layer)[i];
    const ccNum = i + 1 + offsets.cc;
    const key   = `${layer}-${i}`;

    const mode  = ch ? RING_MODE_FAN : RING_MODE_OFF;
    const value = ch ? volumePercentageToEncoder(ch.volume) : 0;
    const muted = ch ? ch.muted : false;

    // Always resend mode + value every tick.
    // The device silently resets LED state on every layer switch (no MIDI event),
    // so there is no other way to stay consistent.
    midiOutput().send('cc', { controller: ccNum, value: mode,  channel: RING_MODE_CHANNEL });
    midiOutput().send('cc', { controller: ccNum, value,         channel: RING_VALUE_CHANNEL });

    // Mute button LED: only send on change (it does not reset on layer switch)
    const prev = prevState[key];
    if (!prev || prev.muted !== muted) {
      midiOutput().send('noteon', { note: i + offsets.row1Note, velocity: muted ? 127 : 0, channel: BUTTON_CHANNEL });
    }

    prevState[key] = { muted };
  }
};

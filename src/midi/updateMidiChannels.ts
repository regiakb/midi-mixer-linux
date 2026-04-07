import { volumePercentageToEncoder } from '../helpers/volume';
import { mediaChannelsType, mediaChannelType } from '../types';
import { Layer } from '../config';
import { midiNrOfChannels, midiOutput } from './midiConnection';

// X-Touch Mini Standard mode
// Layer A: CC 1-8 (ring), notes 8-15 (row1 LED), notes 16-23 (row2 LED)
// Layer B: CC 11-18 (ring), notes 40-47 (row1 LED), notes 48-55 (row2 LED)
const RING_MODE_CHANNEL = 0;
const RING_VALUE_CHANNEL = 10;
const BUTTON_CHANNEL = 10;
const RING_MODE_FAN = 2;

const LAYER_OFFSETS = {
  a: { cc: 0,  row1Note: 8,  row2Note: 16 },
  b: { cc: 10, row1Note: 40, row2Note: 48 },
};

export const updateMidiChannels = (mediaChannels: (layer: Layer) => mediaChannelsType, layer: Layer) => {
  const offsets = LAYER_OFFSETS[layer];
  for (let i = 0; i < midiNrOfChannels(); i++) {
    const ch = mediaChannels(layer)[i];
    const ccNum = i + 1 + offsets.cc;
    if (ch) {
      midiOutput().send('cc', { controller: ccNum, value: RING_MODE_FAN, channel: RING_MODE_CHANNEL });
      midiOutput().send('cc', { controller: ccNum, value: volumePercentageToEncoder(ch.volume), channel: RING_VALUE_CHANNEL });
      midiOutput().send('noteon', { note: i + offsets.row1Note, velocity: ch.muted ? 127 : 0, channel: BUTTON_CHANNEL });
    } else {
      midiOutput().send('cc', { controller: ccNum, value: RING_MODE_FAN, channel: RING_MODE_CHANNEL });
      midiOutput().send('cc', { controller: ccNum, value: 0, channel: RING_VALUE_CHANNEL });
      midiOutput().send('noteon', { note: i + offsets.row1Note, velocity: 0, channel: BUTTON_CHANNEL });
    }
  }
};

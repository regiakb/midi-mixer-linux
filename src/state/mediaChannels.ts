import { mediaChannelsType } from "../types";
import { Layer } from "../config";

let stateA: mediaChannelsType = [];
let stateB: mediaChannelsType = [];

export const mediaChannels = (layer: Layer = 'a'): mediaChannelsType =>
  layer === 'a' ? stateA : stateB;

export const setMediaChannels = (channels: mediaChannelsType, layer: Layer = 'a'): void => {
  if (layer === 'a') stateA = channels; else stateB = channels;
};

export const updateChannelMute = (index: number, muted: boolean, layer: Layer = 'a'): void => {
  const arr = layer === 'a' ? stateA : stateB;
  if (arr[index]) {
    const updated = [...arr];
    updated[index] = { ...updated[index], muted };
    if (layer === 'a') stateA = updated; else stateB = updated;
  }
};

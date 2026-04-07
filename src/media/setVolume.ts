import { exec } from "../helpers/exec";
import { mediaChannelType } from "../types";

export const setVolume = async (mediaChannel: mediaChannelType, volume: number) => {
  const indices = mediaChannel.indices?.length ? mediaChannel.indices : [mediaChannel.index];
  try {
    await Promise.all(indices.map(idx =>
      exec(`pactl set-${mediaChannel.type}-volume ${idx} ${volume}%`)
    ));
  } catch (error) {
    console.error(error);
  }
};
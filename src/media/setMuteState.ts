import { exec } from "../helpers/exec";
import { mediaChannelType } from "../types";

export const setMuteState = async (mediaChannel: mediaChannelType, muted: boolean) => {
  const indices = mediaChannel.indices?.length ? mediaChannel.indices : [mediaChannel.index];
  const value = muted ? 1 : 0;
  try {
    await Promise.all(indices.map(idx =>
      exec(`pactl set-${mediaChannel.type}-mute ${idx} ${value}`)
    ));
  } catch (error) {
    console.error(error);
  }
};
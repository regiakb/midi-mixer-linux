import { exec } from '../helpers/exec';
import { mediaChannelType, mediaChannelsType, mediaTypeType } from '../types';
import { readConfig, Layer } from '../config';

interface ParsedEntry extends mediaChannelType {
  entryName: string;
  matchKeys: string; // lowercase concat of all matchable fields
}

const parsePactlBlocks = (raw: string, type: mediaTypeType): ParsedEntry[] => {
  const prefix = type === 'sink' ? 'Sink' : type === 'source' ? 'Source' : 'Sink Input';
  const blocks = raw.split(/^(?=Sink Input #|Sink #|Source #)/m).filter(b => b.trim());

  return blocks.flatMap(block => {
    const indexMatch = block.match(new RegExp(`^${prefix} #(\\d+)`));
    if (!indexMatch) return [];

    const stateMatch = block.match(/^\s+State:\s+(\w+)/m);
    const volumeMatch = block.match(/^\s+Volume:.*?(\d+)%/m);
    const muteMatch = block.match(/^\s+Mute:\s+(yes|no)/m);
    const descMatch = block.match(/^\s+Description:\s+(.+)/m);
    const nameMatch = block.match(/^\s+Name:\s+(\S+)/m);
    const appNameMatch = block.match(/application\.name = "([^"]+)"/m);
    const binaryMatch = block.match(/application\.process\.binary = "([^"]+)"/m);
    const appIdMatch = block.match(/pipewire\.access\.portal\.app_id = "([^"]+)"/m);

    // For Flatpak apps, app_id (e.g. "com.spotify.Client") is more meaningful
    // than application.name which may reflect the generic runtime instead.
    const appId = appIdMatch?.[1];
    const displayName = appId
      ? (() => { const p = appId.split('.'); const s = p[p.length - 2] ?? p[0]; return s.charAt(0).toUpperCase() + s.slice(1); })()
      : (appNameMatch?.[1] || descMatch?.[1]?.trim() || '');
    if (!volumeMatch || !muteMatch || !displayName) return [];

    const matchKeys = [
      displayName,
      nameMatch?.[1],
      binaryMatch?.[1],
      appIdMatch?.[1],
    ].filter(Boolean).join(' ').toLowerCase();

    return [{
      index: indexMatch[1],
      indices: [indexMatch[1]],
      state: stateMatch?.[1].toLowerCase() ?? 'running',
      volume: Number(volumeMatch[1]),
      muted: muteMatch[1] === 'yes',
      name: displayName,
      type,
      entryName: nameMatch?.[1] || '',
      matchKeys,
    }];
  });
};

export const fetchMediaChannels = async (layer: Layer = 'a'): Promise<mediaChannelsType> => {
  const [{ stdout: rawSinkInputs }, { stdout: rawSources }, { stdout: rawSinks }] = await Promise.all([
    exec('pactl list sink-inputs'),
    exec('pactl list sources'),
    exec('pactl list sinks'),
  ]);

  const toChannel = ({ entryName: _, matchKeys: __, ...rest }: ParsedEntry): mediaChannelType => ({ ...rest, indices: [rest.index] });
  const sinkInputs = parsePactlBlocks(rawSinkInputs, 'sink-input');
  const sources = parsePactlBlocks(rawSources, 'source').filter(s => !s.entryName.includes('.monitor'));
  const sinks = parsePactlBlocks(rawSinks, 'sink');

  const config = readConfig();
  const SLOT_APPS = (layer === 'a' ? config.layerA : config.layerB).slots;

  return SLOT_APPS.map(keyword => {
    if (!keyword) return undefined as unknown as mediaChannelType;
    const keywords = Array.isArray(keyword) ? keyword : [keyword];

    const matches = (entries: ParsedEntry[]) =>
      entries.filter(s => keywords.some(kw => s.matchKeys.includes(kw)));

    // Try sink-inputs first (app audio), then sources (mics), then sinks (outputs)
    const sinkInputMatches = matches(sinkInputs);
    if (sinkInputMatches.length) {
      const first = toChannel(sinkInputMatches[0]);
      return {
        ...first,
        indices: sinkInputMatches.map(m => m.index),
        volume: Math.round(sinkInputMatches.reduce((sum, m) => sum + m.volume, 0) / sinkInputMatches.length),
        muted: sinkInputMatches.every(m => m.muted),
      };
    }

    const sourceMatch = matches(sources)[0];
    if (sourceMatch) return toChannel(sourceMatch);

    const sinkMatch = matches(sinks)[0];
    if (sinkMatch) return toChannel(sinkMatch);

    return undefined as unknown as mediaChannelType;
  });
};

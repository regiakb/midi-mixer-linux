import { exec } from '../helpers/exec';
import { mediaChannelType, mediaChannelsType, mediaTypeType } from '../types';
import { readConfig, Layer } from '../config';

interface ParsedEntry extends mediaChannelType {
  entryName: string;
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

    const displayName = appNameMatch?.[1] || descMatch?.[1]?.trim() || '';
    if (!volumeMatch || !muteMatch || !displayName) return [];

    return [{
      index: indexMatch[1],
      indices: [indexMatch[1]],
      state: stateMatch?.[1].toLowerCase() ?? 'running',
      volume: Number(volumeMatch[1]),
      muted: muteMatch[1] === 'yes',
      name: displayName,
      type,
      entryName: nameMatch?.[1] || '',
    }];
  });
};

export const fetchMediaChannels = async (layer: Layer = 'a'): Promise<mediaChannelsType> => {
  const [{ stdout: rawSinkInputs }, { stdout: rawSources }, { stdout: rawSinks }] = await Promise.all([
    exec('pactl list sink-inputs'),
    exec('pactl list sources'),
    exec('pactl list sinks'),
  ]);

  const toChannel = ({ entryName: _, ...rest }: ParsedEntry): mediaChannelType => ({ ...rest, indices: [rest.index] });
  const sinkInputs = parsePactlBlocks(rawSinkInputs, 'sink-input');
  const sources = parsePactlBlocks(rawSources, 'source').filter(s => !s.entryName.includes('.monitor'));
  const sinks = parsePactlBlocks(rawSinks, 'sink');

  const config = readConfig();
  const SLOT_APPS = (layer === 'a' ? config.layerA : config.layerB).slots;

  return SLOT_APPS.map(keyword => {
    if (!keyword) return undefined as unknown as mediaChannelType;
    const keywords = Array.isArray(keyword) ? keyword : [keyword];

    // Try sink-inputs first (app audio), then sources (mics), then sinks (outputs)
    const sinkInputMatches = sinkInputs.filter(s =>
      keywords.some(kw => s.name.toLowerCase().includes(kw) || s.entryName.toLowerCase().includes(kw))
    );
    if (sinkInputMatches.length) {
      const first = toChannel(sinkInputMatches[0]);
      return {
        ...first,
        indices: sinkInputMatches.map(m => m.index),
        volume: Math.round(sinkInputMatches.reduce((sum, m) => sum + m.volume, 0) / sinkInputMatches.length),
        muted: sinkInputMatches.every(m => m.muted),
      };
    }

    const sourceMatch = sources.find(s =>
      keywords.some(kw => s.entryName.toLowerCase().includes(kw) || s.name.toLowerCase().includes(kw))
    );
    if (sourceMatch) return toChannel(sourceMatch);

    const sinkMatch = sinks.find(s =>
      keywords.some(kw => s.entryName.toLowerCase().includes(kw) || s.name.toLowerCase().includes(kw))
    );
    if (sinkMatch) return toChannel(sinkMatch);

    return undefined as unknown as mediaChannelType;
  });
};

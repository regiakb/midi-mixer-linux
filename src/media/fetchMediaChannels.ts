import { exec } from '../helpers/exec';
import { mediaChannelType, mediaChannelsType, mediaTypeType } from '../types';
import { readConfig, Layer } from '../config';

interface ParsedEntry extends mediaChannelType {
  entryName: string;
  matchKeys: string; // lowercase concat of all matchable fields
}

export interface PactlData {
  sinkInputs: ParsedEntry[];
  sources: ParsedEntry[];
  sinks: ParsedEntry[];
}

const parsePactlBlocks = (
  raw: string,
  type: mediaTypeType,
  clientMap: Map<string, { name: string; binary?: string }> = new Map(),
): ParsedEntry[] => {
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
    const clientIdMatch = block.match(/client\.id = "([^"]+)"/m);

    // Fallback to client map when application.name is absent (e.g. Spotify via PipeWire)
    const clientEntry = clientIdMatch ? clientMap.get(clientIdMatch[1]) : undefined;

    // Prefer portal app_id (Flatpak) or process binary over application.name,
    // which may reflect a generic runtime (e.g. "Chromium", "SDL Application").
    const appId = appIdMatch?.[1];
    const binary = binaryMatch?.[1] ?? clientEntry?.binary;
    const rawAppName = appNameMatch?.[1] ?? clientEntry?.name;
    const displayName = appId
      ? (() => { const p = appId.split('.'); const s = p[p.length - 2] ?? p[0]; return s.charAt(0).toUpperCase() + s.slice(1); })()
      : binary
        ? binary.charAt(0).toUpperCase() + binary.slice(1)
        : (rawAppName || descMatch?.[1]?.trim() || '');
    if (!volumeMatch || !muteMatch || !displayName) return [];

    const matchKeys = [
      displayName,
      rawAppName, // original application.name (e.g. "WEBRTC Voice Engine") for keyword matching
      nameMatch?.[1],
      binary,
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

export const fetchPactlData = async (): Promise<PactlData> => {
  const [{ stdout: rawSinkInputs }, { stdout: rawSources }, { stdout: rawSinks }, { stdout: rawClients }] = await Promise.all([
    exec('pactl list sink-inputs'),
    exec('pactl list sources'),
    exec('pactl list sinks'),
    exec('pactl list clients'),
  ]);

  // Build client map for sink-inputs missing application.name (e.g. Spotify via PipeWire)
  const clientMap = new Map<string, { name: string; binary?: string }>();
  for (const cb of rawClients.split(/^(?=Client #)/m).filter(b => b.trim())) {
    const objId = cb.match(/object\.id = "([^"]+)"/m)?.[1];
    const name = cb.match(/application\.name = "([^"]+)"/m)?.[1];
    const binary = cb.match(/application\.process\.binary = "([^"]+)"/m)?.[1];
    if (objId && name) clientMap.set(objId, { name, binary });
  }

  return {
    sinkInputs: parsePactlBlocks(rawSinkInputs, 'sink-input', clientMap),
    sources: parsePactlBlocks(rawSources, 'source').filter(s => !s.entryName.includes('.monitor')),
    sinks: parsePactlBlocks(rawSinks, 'sink'),
  };
};

const toChannel = ({ entryName: _, matchKeys: __, ...rest }: ParsedEntry): mediaChannelType => ({ ...rest, indices: [rest.index] });

export const resolveMediaChannels = (data: PactlData, layer: Layer): mediaChannelsType => {
  const config = readConfig();
  const SLOT_APPS = (layer === 'a' ? config.layerA : config.layerB).slots;

  return SLOT_APPS.map(keyword => {
    if (!keyword) return undefined as unknown as mediaChannelType;
    const keywords = Array.isArray(keyword) ? keyword : [keyword];

    const matches = (entries: ParsedEntry[]) =>
      entries.filter(s => keywords.some(kw => s.matchKeys.includes(kw)));

    // Try sink-inputs first (app audio), then sources (mics), then sinks (outputs).
    // Only fall through to sources/sinks if the keyword looks like a device name
    // (contains a dot or known prefix), not a generic app keyword — this prevents
    // a WebRTC capture source from matching an app slot like "webrtc voiceengine".
    const isDeviceKeyword = keywords.some(kw => kw.includes('.') || kw.startsWith('alsa_'));

    const sinkInputMatches = matches(data.sinkInputs);
    if (sinkInputMatches.length) {
      const first = toChannel(sinkInputMatches[0]);
      return {
        ...first,
        indices: sinkInputMatches.map(m => m.index),
        volume: Math.round(sinkInputMatches.reduce((sum, m) => sum + m.volume, 0) / sinkInputMatches.length),
        muted: sinkInputMatches.every(m => m.muted),
      };
    }

    if (!isDeviceKeyword) return undefined as unknown as mediaChannelType;

    const sourceMatch = matches(data.sources)[0];
    if (sourceMatch) return toChannel(sourceMatch);

    const sinkMatch = matches(data.sinks)[0];
    if (sinkMatch) return toChannel(sinkMatch);

    return undefined as unknown as mediaChannelType;
  });
};

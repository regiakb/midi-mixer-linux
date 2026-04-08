import express from 'express';
import * as path from 'path';
import { exec } from './helpers/exec';
import { readConfig, writeConfig, CONFIG_PATH_EXPORT, LayerConfig } from './config';
import { mediaChannels } from './state/mediaChannels';
import { getChannelName, setChannelName, clearChannelName } from './state/channelNames';
import { isMidiConnected, reconnectMidi } from './midi/midiConnection';
import { listenToMidi } from './midi/listenToMidi';

const PORT = 3000;

type AppEntry = { name: string; keyword: string; volume: number; muted: boolean; type: 'sink-input' | 'source' | 'sink' };

const parseRunningApps = async (): Promise<AppEntry[]> => {
  const [{ stdout: rawInputs }, { stdout: rawSources }, { stdout: rawSinks }] = await Promise.all([
    exec('pactl list sink-inputs'),
    exec('pactl list sources'),
    exec('pactl list sinks'),
  ]);

  const apps: AppEntry[] = [];

  const inputBlocks = rawInputs.split(/^(?=Sink Input #)/m).filter(b => b.trim());
  for (const block of inputBlocks) {
    const appNameMatch = block.match(/application\.name = "([^"]+)"/m);
    const binaryMatch = block.match(/application\.process\.binary = "([^"]+)"/m);
    const appIdMatch = block.match(/pipewire\.access\.portal\.app_id = "([^"]+)"/m);
    const volumeMatch = block.match(/Volume:.*?(\d+)%/m);
    const muteMatch = block.match(/Mute:\s+(yes|no)/m);
    if (!appNameMatch) continue;
    const rawName = appNameMatch[1];
    const appId = appIdMatch?.[1];
    const binary = binaryMatch?.[1];
    const name = appId
      ? (() => { const p = appId.split('.'); const s = p[p.length - 2] ?? p[0]; return s.charAt(0).toUpperCase() + s.slice(1); })()
      : binary
        ? binary.charAt(0).toUpperCase() + binary.slice(1)
        : rawName;
    const keyword = rawName.toLowerCase();
    if (!apps.find(a => a.keyword === keyword)) {
      apps.push({ name, keyword, volume: Number(volumeMatch?.[1] ?? 0), muted: muteMatch?.[1] === 'yes', type: 'sink-input' });
    }
  }

  const sourceBlocks = rawSources.split(/^(?=Source #)/m).filter(b => b.trim());
  for (const block of sourceBlocks) {
    const nameMatch = block.match(/^\s+Name:\s+(\S+)/m);
    const descMatch = block.match(/^\s+Description:\s+(.+)/m);
    const volumeMatch = block.match(/Volume:.*?(\d+)%/m);
    const muteMatch = block.match(/Mute:\s+(yes|no)/m);
    if (!nameMatch || nameMatch[1].includes('.monitor')) continue;
    const desc = descMatch?.[1]?.trim() || nameMatch[1];
    apps.push({ name: `${desc} (Mic)`, keyword: nameMatch[1].toLowerCase(), volume: Number(volumeMatch?.[1] ?? 0), muted: muteMatch?.[1] === 'yes', type: 'source' });
  }

  const sinkBlocks = rawSinks.split(/^(?=Sink #)/m).filter(b => b.trim());
  for (const block of sinkBlocks) {
    const nameMatch = block.match(/^\s+Name:\s+(\S+)/m);
    const descMatch = block.match(/^\s+Description:\s+(.+)/m);
    const volumeMatch = block.match(/Volume:.*?(\d+)%/m);
    const muteMatch = block.match(/Mute:\s+(yes|no)/m);
    if (!nameMatch) continue;
    const desc = descMatch?.[1]?.trim() || nameMatch[1];
    apps.push({ name: `${desc} (Salida)`, keyword: nameMatch[1].toLowerCase(), volume: Number(volumeMatch?.[1] ?? 0), muted: muteMatch?.[1] === 'yes', type: 'sink' });
  }

  return apps;
};

const getMasterVolume = async (): Promise<number> => {
  try {
    const { stdout } = await exec('pactl get-sink-volume @DEFAULT_SINK@');
    const match = stdout.match(/(\d+)%/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
};

const buildLayerChannels = (layerCfg: LayerConfig, layerKey: 'a' | 'b', runningApps: AppEntry[]) => {
  const channels = mediaChannels(layerKey);
  return layerCfg.slots.map((keyword, i) => {
    const keywords = keyword ? (Array.isArray(keyword) ? keyword : [keyword]) : [];
    const running = keywords.length
      ? runningApps.find(a => keywords.some(kw => a.keyword.includes(kw) || kw.includes(a.keyword)))
      : null;
    const live = channels[i];
    const resolvedName = live?.name ?? running?.name ?? null;
    const cacheKey = `${layerKey}-${i}`;
    if (resolvedName) setChannelName(cacheKey, resolvedName);
    const fallbackName = Array.isArray(keyword) ? keyword.join(' + ') : keyword;
    return {
      index: i,
      keyword,
      buttonAction: layerCfg.buttonActions[i] ?? null,
      bottomRow1Action: layerCfg.bottomRow1Actions[i] ?? null,
      bottomRow2Action: layerCfg.bottomRow2Actions[i] ?? null,
      name: resolvedName ?? getChannelName(cacheKey) ?? fallbackName ?? null,
      volume: live?.volume ?? running?.volume ?? 0,
      muted: live?.muted ?? running?.muted ?? false,
      running: !!live || !!running,
    };
  });
};

const normalizeLayerBody = (raw: any): LayerConfig => {
  const slots = Array.isArray(raw?.slots) ? raw.slots.slice(0, 8) : Array(8).fill(null);
  const buttonActions = Array.isArray(raw?.buttonActions) ? raw.buttonActions.slice(0, 8) : Array(8).fill(null);
  const bottomRow1Actions = Array.isArray(raw?.bottomRow1Actions) ? raw.bottomRow1Actions.slice(0, 8) : Array(8).fill(null);
  const bottomRow2Actions = Array.isArray(raw?.bottomRow2Actions) ? raw.bottomRow2Actions.slice(0, 8) : Array(8).fill(null);
  while (slots.length < 8) slots.push(null);
  while (buttonActions.length < 8) buttonActions.push(null);
  while (bottomRow1Actions.length < 8) bottomRow1Actions.push(null);
  while (bottomRow2Actions.length < 8) bottomRow2Actions.push(null);
  return { slots, buttonActions, bottomRow1Actions, bottomRow2Actions };
};

export const startServer = () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/state', async (_req, res) => {
    const config = readConfig();
    const [runningApps, masterVolume] = await Promise.all([parseRunningApps(), getMasterVolume()]);

    res.json({
      layerA: {
        slots: config.layerA.slots,
        buttonActions: config.layerA.buttonActions,
        bottomRow1Actions: config.layerA.bottomRow1Actions,
        bottomRow2Actions: config.layerA.bottomRow2Actions,
        channels: buildLayerChannels(config.layerA, 'a', runningApps),
      },
      layerB: {
        slots: config.layerB.slots,
        buttonActions: config.layerB.buttonActions,
        bottomRow1Actions: config.layerB.bottomRow1Actions,
        bottomRow2Actions: config.layerB.bottomRow2Actions,
        channels: buildLayerChannels(config.layerB, 'b', runningApps),
      },
      runningApps,
      masterVolume,
      midiConnected: isMidiConnected(),
    });
  });

  app.post('/api/config', (req, res) => {
    const { layerA, layerB } = req.body;
    if (!layerA || !layerB) {
      return res.status(400).json({ error: 'layerA and layerB are required' });
    }
    const oldConfig = readConfig();
    const newLayerA = normalizeLayerBody(layerA);
    const newLayerB = normalizeLayerBody(layerB);
    // Invalidate cached name for any slot whose keyword assignment changed
    (['a', 'b'] as const).forEach(lk => {
      const oldSlots = lk === 'a' ? oldConfig.layerA.slots : oldConfig.layerB.slots;
      const newSlots = lk === 'a' ? newLayerA.slots : newLayerB.slots;
      oldSlots.forEach((oldKw, i) => {
        if (JSON.stringify(oldKw) !== JSON.stringify(newSlots[i])) {
          clearChannelName(`${lk}-${i}`);
        }
      });
    });
    writeConfig({ layerA: newLayerA, layerB: newLayerB });
    res.json({ ok: true });
  });

  app.get('/api/config/export', (_req, res) => {
    res.download(CONFIG_PATH_EXPORT, 'midi-mixer-config.json');
  });

  app.post('/api/config/import', (req, res) => {
    const { layerA, layerB } = req.body;
    if (!layerA || !layerB) {
      return res.status(400).json({ error: 'Invalid config: layerA and layerB are required' });
    }
    writeConfig({ layerA: normalizeLayerBody(layerA), layerB: normalizeLayerBody(layerB) });
    res.json({ ok: true });
  });

  app.post('/api/volume/master', async (req, res) => {
    const { volume } = req.body;
    if (typeof volume !== 'number' || volume < 0 || volume > 100) {
      return res.status(400).json({ error: 'Invalid volume value' });
    }
    await exec(`pactl set-sink-volume @DEFAULT_SINK@ ${volume}%`);
    res.json({ ok: true });
  });

  app.post('/api/midi/reconnect', (_req, res) => {
    try {
      reconnectMidi();
      listenToMidi();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/logs', async (_req, res) => {
    try {
      const { stdout } = await exec('journalctl --user -u audio-midi-controller.service -n 80 --no-pager --output=short-iso');
      res.json({ logs: stdout });
    } catch {
      res.json({ logs: '(could not retrieve logs)' });
    }
  });

  app.listen(PORT, () => {
    console.log(`Midi Mixer running at http://localhost:${PORT}`);
  });
};

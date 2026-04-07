import * as fs from 'fs';
import * as path from 'path';

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

export type Layer = 'a' | 'b';

export interface LayerConfig {
  slots: (string | string[] | null)[];
  buttonActions: (string | null)[];    // encoder push: null = mute
  bottomRow1Actions: (string | null)[]; // row 1 buttons: null = mute
  bottomRow2Actions: (string | null)[]; // row 2 buttons: null = mute
}

export interface SlotConfig {
  layerA: LayerConfig;
  layerB: LayerConfig;
}

const emptyLayer = (): LayerConfig => ({
  slots: Array(8).fill(null),
  buttonActions: Array(8).fill(null),
  bottomRow1Actions: Array(8).fill(null),
  bottomRow2Actions: Array(8).fill(null),
});

const DEFAULT: SlotConfig = {
  layerA: {
    slots: ['brave', 'spotify', 'discord', null, 'cs2', null, null, null],
    buttonActions: Array(8).fill(null),
    bottomRow1Actions: Array(8).fill(null),
    bottomRow2Actions: Array(8).fill(null),
  },
  layerB: emptyLayer(),
};

const normalizeLayer = (raw: Partial<LayerConfig>): LayerConfig => {
  const slots = Array.isArray(raw.slots) ? raw.slots.slice(0, 8) : Array(8).fill(null);
  const buttonActions = Array.isArray(raw.buttonActions) ? raw.buttonActions.slice(0, 8) : Array(8).fill(null);
  const bottomRow1Actions = Array.isArray(raw.bottomRow1Actions)
    ? raw.bottomRow1Actions.slice(0, 8)
    : Array.isArray((raw as any).bottomActions) ? (raw as any).bottomActions.slice(0, 8) : Array(8).fill(null);
  const bottomRow2Actions = Array.isArray(raw.bottomRow2Actions) ? raw.bottomRow2Actions.slice(0, 8) : Array(8).fill(null);
  while (slots.length < 8) slots.push(null);
  while (buttonActions.length < 8) buttonActions.push(null);
  while (bottomRow1Actions.length < 8) bottomRow1Actions.push(null);
  while (bottomRow2Actions.length < 8) bottomRow2Actions.push(null);
  return { slots, buttonActions, bottomRow1Actions, bottomRow2Actions };
};

export const readConfig = (): SlotConfig => {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // New format
    if (data.layerA) {
      return {
        layerA: normalizeLayer(data.layerA),
        layerB: normalizeLayer(data.layerB ?? {}),
      };
    }
    // Migrate old flat format → layerA
    return {
      layerA: normalizeLayer(data),
      layerB: emptyLayer(),
    };
  } catch {
    return { layerA: { ...DEFAULT.layerA }, layerB: emptyLayer() };
  }
};

export const writeConfig = (config: SlotConfig): void => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
};

export const CONFIG_PATH_EXPORT = CONFIG_PATH;

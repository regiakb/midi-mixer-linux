import * as fs from 'fs';
import * as path from 'path';

const NAMES_PATH = path.join(__dirname, '..', '..', 'channel-names.json');

type NamesMap = Record<string, string>;

const load = (): NamesMap => {
  try {
    return JSON.parse(fs.readFileSync(NAMES_PATH, 'utf8'));
  } catch {
    return {};
  }
};

let cache: NamesMap = load();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleSave = () => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(NAMES_PATH, JSON.stringify(cache, null, 2));
  }, 2000);
};

export const getChannelName = (key: string): string | undefined => cache[key];

export const setChannelName = (key: string, name: string): void => {
  if (cache[key] === name) return;
  cache[key] = name;
  scheduleSave();
};

export const clearChannelName = (key: string): void => {
  if (!(key in cache)) return;
  delete cache[key];
  scheduleSave();
};

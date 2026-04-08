import { Layer } from '../config';

let _activeLayer: Layer = 'a';

export const getActiveLayer = (): Layer => _activeLayer;
export const setActiveLayer = (layer: Layer): void => { _activeLayer = layer; };

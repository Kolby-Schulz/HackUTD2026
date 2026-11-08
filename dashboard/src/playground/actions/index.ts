// Frozen after WP-07. Importing this file registers every area's actions.
import { registerAll } from '../core/actions';
import { actions as tools } from './tools';
import { actions as edit } from './edit';
import { actions as clipboard } from './clipboard';
import { actions as arrange } from './arrange';
import { actions as align } from './align';
import { actions as layers } from './layers';
import { actions as view } from './view';
import { actions as panels } from './panels';
import { actions as share } from './share';
import { actions as text } from './text';
import { actions as agents } from './agents';
import { actions as file } from './file';
import { actions as demo } from './demo';
import { actions as present } from './present';
import { actions as palette } from './palette';
import { actions as help } from './help';

registerAll([...tools, ...edit, ...clipboard, ...arrange, ...align, ...layers, ...view, ...panels, ...share, ...text, ...agents, ...file, ...demo, ...present, ...palette, ...help]);

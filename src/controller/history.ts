// Undo and redo of project changes.

import { redo, undo } from '../model/state';
import { toast } from '../view/feedback';

export const undoChange = () => undo() || toast('Nothing to undo.');
export const redoChange = () => redo() || toast('Nothing to redo.');
